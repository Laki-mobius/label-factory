import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Same real, catalog-validated model choice used by field-suggest — null
 *  means "use the active provider's default". */
const modelChoice = z.object({
  provider: z.enum(["openai", "gemini"]),
  modelId: z.string().min(1),
});

const input = z.object({
  model: modelChoice.nullable(),
  documentType: z.string().max(120),
  displayName: z.string().min(1).max(120),
  key: z.string().min(1).max(120),
  dataType: z.string().max(40),
  existingDescription: z.string().max(400).optional(),
});

/** "AI Describe" — (re)generates one field's description on demand. */
export const describeFieldWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { describeField } = await import("./field-describe.server");
    const { resolveAiModel, resolveExplicitModel } = await import("./ai-provider.server");
    const model = data.model ? resolveExplicitModel(data.model.provider, data.model.modelId) : resolveAiModel();
    const description = await describeField({
      model,
      documentType: data.documentType,
      displayName: data.displayName,
      key: data.key,
      dataType: data.dataType,
      existingDescription: data.existingDescription,
    });
    return { description };
  });
