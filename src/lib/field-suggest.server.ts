import { generateText } from "ai";
import { resolveAiModel } from "@/lib/ai-provider.server";

/** Legacy fixed taxonomy — no longer used to constrain AI output, kept only
 *  as the fallback bucket name when the model omits one. */
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
  /** A short, document-type-specific category name the model invents itself
   *  (e.g. "Shipment Details" for a bill of lading) — no longer restricted
   *  to a fixed list, so fields group naturally by what the document is. */
  bucket: string;
  description: string;
  confidence: number;
};

const SYSTEM = `You are a document data-extraction schema designer for a multi-industry labeling platform.
Return ONLY a JSON object of the shape:
{"fields":[{"key":"snake_case_key","display_name":"Human Label","data_type":"text|identifier|date|currency|number|boolean|multi_value","bucket":"Category Name","description":"one short sentence","confidence":0.0-1.0}]}
Rules: 12-24 fields, no duplicates, keys are lowercase snake_case, prefer industry-specific fields that a generic checklist would miss, no markdown fences.
Bucket rules: keep the total number of groups as small as practical — aim for 3-5 for the whole document type, and only ever exceed 5 if the document genuinely has more clearly distinct categories of information. Each group name should be short (2-4 words, Title Case) and broad enough to hold several related fields — never invent a group for just one field unless nothing else fits, and prefer one broader group over several narrow ones (e.g. a single "Parties & Entities" rather than separate "Buyer Details"/"Seller Details"). If the prompt below lists groups already used in this schema, treat those as the first choice: reuse one of those exact names (matching spelling and capitalization exactly) for every field that reasonably fits it, and invent a new group only for fields that truly don't belong in any of them — the goal is one shared set of groups across every field in the schema, regardless of whether a field came from this request or an earlier one. Every group you use, existing or new, must have at least one field. Order fields in the array by group so fields in the same group are adjacent.`;

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
    const bucketRaw = String(row["bucket"] ?? "").trim().slice(0, 40);
    const confidence = Number(row["confidence"]);
    out.push({
      key,
      display_name: String(row["display_name"] ?? key).slice(0, 80) || key,
      data_type: (DATA_TYPES as readonly string[]).includes(dataType)
        ? (dataType as SuggestedField["data_type"])
        : "text",
      bucket: bucketRaw || "Miscellaneous",
      description: String(row["description"] ?? "").slice(0, 200),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
    });
    if (out.length >= 40) break;
  }
  return out;
}

async function run(model: ReturnType<typeof resolveAiModel>, prompt: string): Promise<SuggestedField[]> {
  const result = await generateText({
    model,
    system: SYSTEM,
    prompt,
  });
  return parseFields(result.text);
}

/** Renders the "reuse these exact group names first" hint appended to every
 *  suggestion prompt once the schema already has groups — keeps repeated
 *  AI-suggest / Generate-from-sample runs on the same profile converging on
 *  one shared set of buckets instead of each run inventing its own. */
function existingBucketsHint(existingBuckets: string[] | undefined): string {
  if (!existingBuckets || existingBuckets.length === 0) return "";
  return `\n\nGroups already used in this schema (reuse one of these exact names, matching capitalization, whenever a field fits): ${existingBuckets.join(", ")}`;
}

export async function suggestFromDocumentType(input: {
  /** An already-resolved AI SDK model — the caller (field-suggest.functions.ts)
   *  picks the profile's chosen provider/model, or the active default. */
  model: ReturnType<typeof resolveAiModel>;
  documentType: string;
  industry: string;
  /** Bucket/group names already present in this profile's schema (from an
   *  earlier AI-suggest, sample, or manual add) — passed back in so this run
   *  reuses them instead of inventing a parallel set of near-duplicates. */
  existingBuckets?: string[];
}): Promise<SuggestedField[]> {
  return run(
    input.model,
    `Industry context: ${input.industry}.
Document type: "${input.documentType}".
Propose the extraction fields a reviewer would need for this document type.${existingBucketsHint(input.existingBuckets)}`,
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
  model: ReturnType<typeof resolveAiModel>;
  documentType: string;
  industry: string;
  filename: string;
  text: string;
  /** See suggestFromDocumentType — same reuse-existing-groups hint. */
  existingBuckets?: string[];
}): Promise<SuggestedField[]> {
  return run(
    input.model,
    `Industry context: ${input.industry}.
Declared document type: "${input.documentType}".
Below is the REAL extracted text of a sample file (${input.filename}). Base your field proposals on what actually appears in it, including industry-specific values, table columns, identifiers and totals you can see.

--- SAMPLE START ---
${input.text.slice(0, 24000)}
--- SAMPLE END ---${existingBucketsHint(input.existingBuckets)}`,
  );
}
