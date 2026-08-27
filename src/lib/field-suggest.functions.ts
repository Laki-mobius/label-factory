import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const typeInput = z.object({
  model: z.string().min(1),
  documentType: z.string().min(1).max(120),
  industry: z.string().min(1).max(60),
});

const sampleInput = z.object({
  model: z.string().min(1),
  documentType: z.string().max(120),
  industry: z.string().max(60),
  filename: z.string().min(1).max(260),
  mimeType: z.string().max(120),
  /** base64 payload, capped well under the request limit. */
  base64: z.string().min(1).max(14_000_000),
});

export const generateFieldsFromType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => typeInput.parse(data))
  .handler(async ({ data }) => {
    const { suggestFromDocumentType } = await import("./field-suggest.server");
    const fields = await suggestFromDocumentType(data);
    return { fields, source: "type" as const, generatedAt: new Date().toISOString() };
  });

export const generateFieldsFromSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => sampleInput.parse(data))
  .handler(async ({ data }) => {
    const { extractSampleText, suggestFromSampleText } = await import("./field-suggest.server");
    const { text, pages } = await extractSampleText(data);
    if (text.replace(/\s/g, "").length < 40) {
      throw new Error(
        "No readable text was found in that sample. Scanned/image-only PDFs are not supported yet.",
      );
    }
    const fields = await suggestFromSampleText({
      model: data.model,
      documentType: data.documentType || "unknown",
      industry: data.industry,
      filename: data.filename,
      text,
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
