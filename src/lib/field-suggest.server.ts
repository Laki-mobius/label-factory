import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

export const BUCKETS = [
  "Document Details",
  "Parties & Entities",
  "Financial Information",
  "Dates & Timeline",
  "Transaction Details",
  "Miscellaneous",
] as const;

export const DATA_TYPES = [
  "text",
  "identifier",
  "date",
  "currency",
  "number",
  "boolean",
  "multi_value",
] as const;

export type SuggestedField = {
  key: string;
  display_name: string;
  data_type: (typeof DATA_TYPES)[number];
  bucket: (typeof BUCKETS)[number];
  description: string;
  confidence: number;
};

function gateway() {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
  });
}

const SYSTEM = `You are a document data-extraction schema designer for a multi-industry labeling platform.
Return ONLY a JSON object of the shape:
{"fields":[{"key":"snake_case_key","display_name":"Human Label","data_type":"text|identifier|date|currency|number|boolean|multi_value","bucket":"Document Details|Parties & Entities|Financial Information|Dates & Timeline|Transaction Details|Miscellaneous","description":"one short sentence","confidence":0.0-1.0}]}
Rules: 12-24 fields, no duplicates, keys are lowercase snake_case, prefer industry-specific fields that a generic checklist would miss, no markdown fences.`;

function parseFields(raw: string): SuggestedField[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { fields?: unknown })?.fields;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SuggestedField[] = [];
  for (const item of list) {
    const row = item as Record<string, unknown>;
    const key = String(row["key"] ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const dataType = String(row["data_type"] ?? "text");
    const bucket = String(row["bucket"] ?? "Miscellaneous");
    const confidence = Number(row["confidence"]);
    out.push({
      key,
      display_name: String(row["display_name"] ?? key).slice(0, 80) || key,
      data_type: (DATA_TYPES as readonly string[]).includes(dataType)
        ? (dataType as SuggestedField["data_type"])
        : "text",
      bucket: (BUCKETS as readonly string[]).includes(bucket)
        ? (bucket as SuggestedField["bucket"])
        : "Miscellaneous",
      description: String(row["description"] ?? "").slice(0, 200),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
    });
    if (out.length >= 40) break;
  }
  return out;
}

async function run(model: string, prompt: string): Promise<SuggestedField[]> {
  const result = await generateText({
    model: gateway()(model),
    system: SYSTEM,
    prompt,
  });
  return parseFields(result.text);
}

export async function suggestFromDocumentType(input: {
  model: string;
  documentType: string;
  industry: string;
}): Promise<SuggestedField[]> {
  return run(
    input.model,
    `Industry context: ${input.industry}.
Document type: "${input.documentType}".
Propose the extraction fields a reviewer would need for this document type.`,
  );
}

/** Pull real text out of the uploaded sample so the model reads actual content. */
export async function extractSampleText(input: {
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<{ text: string; pages: number }> {
  const bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0));
  const isPdf =
    input.mimeType.includes("pdf") || input.filename.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: String(text), pages: totalPages };
  }

  const html = new TextDecoder().decode(bytes);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, pages: 1 };
}

export async function suggestFromSampleText(input: {
  model: string;
  documentType: string;
  industry: string;
  filename: string;
  text: string;
}): Promise<SuggestedField[]> {
  return run(
    input.model,
    `Industry context: ${input.industry}.
Declared document type: "${input.documentType}".
Below is the REAL extracted text of a sample file (${input.filename}). Base your field proposals on what actually appears in it, including industry-specific values, table columns, identifiers and totals you can see.

--- SAMPLE START ---
${input.text.slice(0, 24000)}
--- SAMPLE END ---`,
  );
}
