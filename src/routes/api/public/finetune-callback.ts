import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const payloadSchema = z.object({
  job_id: z.string().uuid(),
  token: z.string().min(8),
  status: z.enum(["queued", "running", "complete", "failed"]),
  result_model: z.string().max(200).optional(),
  error_message: z.string().max(2000).optional(),
  log: z.string().max(2000).optional(),
});

/**
 * Callback for an external / self-hosted training process to report job state.
 * Each job carries its own token; no shared secret is required.
 */
export const Route = createFileRoute("/api/public/finetune-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = payloadSchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid payload" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: job, error } = await supabaseAdmin
          .from("finetune_jobs")
          .select("id, callback_token, logs")
          .eq("id", parsed.job_id)
          .maybeSingle();

        if (error || !job || job.callback_token !== parsed.token) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const logs = Array.isArray(job.logs) ? job.logs : [];
        const nextLogs = [
          ...logs,
          {
            at: new Date().toISOString(),
            status: parsed.status,
            message: parsed.log ?? parsed.error_message ?? `Status set to ${parsed.status}`,
          },
        ].slice(-200);

        const { error: updateError } = await supabaseAdmin
          .from("finetune_jobs")
          .update({
            status: parsed.status,
            result_model: parsed.result_model ?? null,
            error_message: parsed.error_message ?? null,
            logs: nextLogs as unknown as never,
            started_at: parsed.status === "running" ? new Date().toISOString() : undefined,
            finished_at:
              parsed.status === "complete" || parsed.status === "failed"
                ? new Date().toISOString()
                : undefined,
          })
          .eq("id", parsed.job_id);

        if (updateError) {
          return new Response(JSON.stringify({ error: "Update failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
