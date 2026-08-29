import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const modelChoice = z.object({
  provider: z.enum(["openai", "gemini"]),
  modelId: z.string().min(1),
  label: z.string().min(1),
});

const modelInput = z.object({
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  profileId: z.string().uuid(),
  models: z.array(modelChoice).min(2).max(3),
});

export const runModelBenchmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => modelInput.parse(data))
  .handler(async ({ data, context }) => {
    const { runModelComparisonBenchmark } = await import("./benchmark-compare.run.server");
    return runModelComparisonBenchmark(context.supabase, context.userId, data);
  });

const schemaInput = z.object({
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  profileVersionIds: z.array(z.string().uuid()).min(2).max(3),
});

export const runSchemaBenchmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schemaInput.parse(data))
  .handler(async ({ data, context }) => {
    const { runSchemaComparisonBenchmark } = await import("./benchmark-compare.run.server");
    return runSchemaComparisonBenchmark(context.supabase, context.userId, data);
  });

const availableModelsInput = z.object({});

export const listAvailableBenchmarkModels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => availableModelsInput.parse(data))
  .handler(async () => {
    const { availableBenchmarkModels } = await import("./ai-provider.server");
    return { models: availableBenchmarkModels() };
  });
