import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  webhookId: z.string().uuid(),
  event: z.string().min(1).max(100),
  isTest: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const sendWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { dispatchWebhook } = await import("./webhooks.run.server");
    return dispatchWebhook(context.supabase, data);
  });
