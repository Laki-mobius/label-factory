import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  projectId: z.string().uuid(),
  profileId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  count: z.number().int().min(1).max(3),
  constraints: z.string().max(2000).default(""),
  existingTitles: z.array(z.string().max(200)).max(40).default([]),
});

export const generateSyntheticRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { runSyntheticGeneration } = await import("./synthetic.run.server");
    return runSyntheticGeneration(context.supabase, context.userId, data);
  });
