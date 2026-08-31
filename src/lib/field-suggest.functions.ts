import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The profile's real, catalog-validated model choice — null means "use the
 *  active provider's default" (see the "Model Selection for Entire Workflow"
 *  picker in label-profile.tsx and ai-provider.server.ts's model catalog). */
const modelChoice = z.object({
  provider: z.enum(["openai", "gemini"]),
  modelId: z.string().min(1),
});

/** Bucket/group names already present in the profile's schema, passed back
 *  in so a repeat "Suggest fields with AI" / "Generate From Sample" run
 *  reuses them instead of inventing a parallel set of near-duplicate groups.
 *  Capped generously — this is a handful of short category names, not user
 *  content. */
const existingBuckets = z.array(z.string().max(40)).max(30).optional();

const typeInput = z.object({
  model: modelChoice.nullable(),
  documentType: z.string().min(1).max(120),
  industry: z.string().min(1).max(60),
  existingBuckets,
});

const sampleInput = z.object({
  model: modelChoice.nullable(),
  documentType: z.string().max(120),
  industry: z.string().max(60),
  filename: z.string().min(1).max(260),
  mimeType: z.string().max(120),
  /** base64 payload, capped well under the request limit. */
  base64: z.string().min(1).max(14_000_000),
  existingBuckets,
});

export const generateFieldsFromType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => typeInput.parse(data))
  .handler(async ({ data }) => {
    const { suggestFromDocumentType } = await import("./field-suggest.server");
    const { resolveAiModel, resolveExplicitModel } = await import("./ai-provider.server");
    const model = data.model ? resolveExplicitModel(data.model.provider, data.model.modelId) : resolveAiModel();
    const fields = await suggestFromDocumentType({
      model,
      documentType: data.documentType,
      industry: data.industry,
      existingBuckets: data.existingBuckets,
    });
    return { fields, source: "type" as const, generatedAt: new Date().toISOString() };
  });

export const generateFieldsFromSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sampleInput.parse(data))
  .handler(async ({ data }) => {
    const { extractSampleText, suggestFromSampleText } = await import("./field-suggest.server");
    const { resolveAiModel, resolveExplicitModel } = await import("./ai-provider.server");
    const { text, pages } = await extractSampleText(data);
    if (text.replace(/\s/g, "").length < 40) {
      throw new Error(
        "No readable text was found in that sample. Scanned/image-only PDFs are not supported yet.",
      );
    }
    const model = data.model ? resolveExplicitModel(data.model.provider, data.model.modelId) : resolveAiModel();
    const fields = await suggestFromSampleText({
      model,
      documentType: data.documentType || "unknown",
      industry: data.industry,
      filename: data.filename,
      text,
      existingBuckets: data.existingBuckets,
    });
    return {
      fields,
      source: "sample" as const,
      generatedAt: new Date().toISOString(),
      pages,
      characters: text.length,
      excerpt: text.slice(0, 400),
    };
  });
