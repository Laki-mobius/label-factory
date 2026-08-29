import { generateText } from "ai";
import { resolveAiModel } from "@/lib/ai-provider.server";

const SYSTEM = `You write a single, precise one-sentence description for a document-extraction field, for a reviewer building a labeling schema.
Return ONLY the description sentence — no quotes, no markdown, no field name repeated verbatim, no extra commentary.`;

/**
 * Regenerates the description for exactly one field, on demand ("AI Describe"
 * in label-profile.tsx). Mirrors the old app's per-field describe action —
 * it only ever produces a description, nothing else (label_hints,
 * confusion_hints, and the extraction prompt are separate, human-owned
 * fields it does not touch).
 */
export async function describeField(input: {
  model: ReturnType<typeof resolveAiModel>;
  documentType: string;
  displayName: string;
  key: string;
  dataType: string;
  existingDescription?: string;
}): Promise<string> {
  const result = await generateText({
    model: input.model,
    system: SYSTEM,
    prompt: `Document type: "${input.documentType || "unknown"}".
Field: "${input.displayName}" (key: ${input.key}, data type: ${input.dataType}).
${
  input.existingDescription
    ? `Current description: "${input.existingDescription}" — improve or correct it if it's vague or wrong.`
    : "Write a new description."
}
Respond with ONLY the one-sentence description, nothing else.`,
  });
  return result.text.trim().replace(/^["']|["']$/g, "").slice(0, 300);
}
