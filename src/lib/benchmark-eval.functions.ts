import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ runId: z.string().uuid() });

/** Runs (and persists) an LLM-graded quality evaluation for one benchmark run. */
export const evaluateBenchmarkRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { runBenchmarkEvaluation } = await import("./benchmark-eval.run.server");
    return runBenchmarkEvaluation(context.supabase, context.userId, data.runId);
  });
