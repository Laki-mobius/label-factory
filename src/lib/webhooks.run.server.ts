import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type DispatchInput = {
  webhookId: string;
  event: string;
  isTest: boolean;
  payload: Record<string, unknown>;
};

/**
 * Delivers a webhook payload to the customer endpoint and records the attempt.
 * Reads the webhook through the caller's RLS-scoped client, so project access
 * is enforced by the database rather than by this function.
 */
export async function dispatchWebhook(supabase: Client, input: DispatchInput) {
  const { data: webhook, error } = await supabase
    .from("webhooks")
    .select("id, project_id, url, auth_token, auth_header, custom_headers, enabled")
    .eq("id", input.webhookId)
    .maybeSingle();
  if (error) throw error;
  if (!webhook) throw new Error("Webhook not found or not accessible.");

  const headers: Record<string, string> = { "content-type": "application/json" };
  for (const [key, value] of Object.entries(
    (webhook.custom_headers ?? {}) as Record<string, unknown>,
  )) {
    if (typeof value === "string" && key.trim()) headers[key.trim()] = value;
  }
  if (webhook.auth_token) {
    const headerName = webhook.auth_header?.trim() || "Authorization";
    headers[headerName] =
      headerName.toLowerCase() === "authorization" && !/^\w+\s/.test(webhook.auth_token)
        ? `Bearer ${webhook.auth_token}`
        : webhook.auth_token;
  }

  const body = JSON.stringify({
    event: input.event,
    test: input.isTest,
    sent_at: new Date().toISOString(),
    data: input.payload,
  });

  const started = Date.now();
  let status: number | null = null;
  let responseBody = "";
  let errorMessage: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    status = response.status;
    responseBody = (await response.text()).slice(0, 4000);
    success = response.ok;
    if (!success) errorMessage = `Endpoint responded with ${response.status}`;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Request failed";
  }

  const duration = Date.now() - started;
  // Redact credentials before persisting the attempt.
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|token|key|secret/i.test(key) ? "«redacted»" : value,
    ]),
  );

  const { error: insertError } = await supabase.from("webhook_deliveries").insert({
    webhook_id: webhook.id,
    project_id: webhook.project_id,
    event: input.event,
    is_test: input.isTest,
    request_payload: JSON.parse(body),
    request_headers: safeHeaders,
    response_status: status,
    response_body: responseBody || null,
    error_message: errorMessage,
    duration_ms: duration,
    success,
  });
  if (insertError) throw insertError;

  return {
    success,
    status,
    durationMs: duration,
    responseBody,
    errorMessage,
    requestHeaders: safeHeaders,
    requestBody: body,
  };
}
