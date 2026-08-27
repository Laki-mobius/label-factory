import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ConnectorInput = {
  projectId: string;
  connectorId?: string | null;
  name: string;
  kind: "hosted" | "self_hosted";
  provider: string;
  modelName: string;
  baseUrl: string | null;
  authType: string;
  /** Null keeps the currently stored (encrypted) key. */
  apiKey: string | null;
  customHeaders: Record<string, string>;
};

/** Runs the provider handshake with the supplied config; nothing is persisted. */
export const testConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConnectorInput) => input)
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("can_access_project", {
      _project_id: data.projectId,
    });
    if (!allowed) throw new Error("You do not have access to this project.");

    const { probeConnector, decryptSecret } = await import("./connector.server");

    let apiKey = data.apiKey;
    if (!apiKey && data.connectorId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await supabaseAdmin
        .from("model_connectors")
        .select("api_key_cipher")
        .eq("id", data.connectorId)
        .maybeSingle();
      apiKey = row?.api_key_cipher ? decryptSecret(row.api_key_cipher) : null;
    }

    return probeConnector({
      provider: data.provider,
      modelName: data.modelName,
      baseUrl: data.baseUrl,
      authType: data.authType,
      apiKey,
      customHeaders: data.customHeaders,
    });
  });

/** Persists the connector. The API key is encrypted before it touches the database. */
export const saveConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConnectorInput) => input)
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("can_access_project", {
      _project_id: data.projectId,
    });
    if (!allowed) throw new Error("You do not have access to this project.");

    const { encryptSecret, maskHint } = await import("./connector.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const base = {
      project_id: data.projectId,
      name: data.name,
      kind: data.kind,
      provider: data.provider,
      model_name: data.modelName,
      base_url: data.baseUrl,
      auth_type: data.authType,
      custom_headers: data.customHeaders,
      is_default: true,
    };

    // A supplied key is always encrypted; there is no plaintext path.
    const secret = data.apiKey
      ? { api_key_cipher: encryptSecret(data.apiKey), api_key_hint: maskHint(data.apiKey) }
      : {};

    if (data.connectorId) {
      const { error } = await supabaseAdmin
        .from("model_connectors")
        .update({ ...base, ...secret })
        .eq("id", data.connectorId)
        .eq("project_id", data.projectId);
      if (error) throw new Error(error.message);
      return { id: data.connectorId };
    }

    if (data.authType !== "none" && !data.apiKey) {
      throw new Error("An API key is required for this auth type.");
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("model_connectors")
      .insert({ ...base, ...secret })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });
