import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ documentId: z.string().uuid() });

/** Drafts correction-reason codes/notes for a document's corrected fields. */
export const draftFeedbackReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { runFeedbackReward } = await import("./reward-ai.run.server");
    return runFeedbackReward(context.supabase, data.documentId);
  });

/** Drafts Model-B candidate values and a suggested preference decision. */
export const draftPreferenceReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { runPreferenceReward } = await import("./reward-ai.run.server");
    return runPreferenceReward(context.supabase, data.documentId);
  });
