import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

export type ProfileField = {
  key: string;
  display_name?: string;
  data_type?: string;
  bucket?: string;
  description?: string;
};

export type ExtractedValue = {
  field_key: string;
  value: string;
  confidence: number;
  evidence: string;
  page: number;
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

const SYSTEM = `You extract structured data from business documents.
Return ONLY a JSON object: {"values":[{"field_key":"...","value":"...","confidence":0.0-1.0,"evidence":"verbatim snippet from the document that supports the value","page":1}]}
Rules: one entry per requested field key, no extras. If a value is genuinely absent, return an empty string with confidence 0. Never invent values. Evidence must be copied verbatim from the document text. No markdown fences.`;

function parseValues(raw: string, fields: ProfileField[]): ExtractedValue[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let list: unknown = [];
  if (start !== -1 && end !== -1) {
    try {
      list = (JSON.parse(cleaned.slice(start, end + 1)) as { values?: unknown })?.values ?? [];
    } catch {
      list = [];
    }
  }
  const byKey = new Map<string, Record<string, unknown>>();
  if (Array.isArray(list)) {
    for (const item of list) {
      const row = item as Record<string, unknown>;
      const key = String(row["field_key"] ?? "").trim();
      if (key) byKey.set(key, row);
    }
  }
  return fields.map((field) => {
    const row = byKey.get(field.key);
    const confidence = Number(row?.["confidence"]);
    const page = Number(row?.["page"]);
    return {
      field_key: field.key,
      value: String(row?.["value"] ?? "").slice(0, 2000),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      evidence: String(row?.["evidence"] ?? "").slice(0, 600),
      page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    };
  });
}

export async function extractDocumentText(input: {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<{ text: string; pages: number }> {
  const isPdf =
    input.mimeType.includes("pdf") || input.filename.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(input.bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: String(text), pages: totalPages };
  }
  const html = new TextDecoder().decode(input.bytes);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, pages: 1 };
}

export async function extractValues(input: {
  model: string;
  documentType: string;
  filename: string;
  text: string;
  fields: ProfileField[];
}): Promise<ExtractedValue[]> {
  const schema = input.fields
    .map(
      (field) =>
        `- ${field.key} (${field.data_type ?? "text"}) — ${field.display_name ?? field.key}${
          field.description ? `: ${field.description}` : ""
        }`,
    )
    .join("\n");

  const result = await generateText({
    model: gateway()(input.model),
    system: SYSTEM,
    prompt: `Document type: "${input.documentType || "unknown"}" (file: ${input.filename}).

Fields to extract:
${schema}

--- DOCUMENT START ---
${input.text.slice(0, 30000)}
--- DOCUMENT END ---`,
  });

  return parseValues(result.text, input.fields);
}
