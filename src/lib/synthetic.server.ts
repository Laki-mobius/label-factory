import { generateText } from "ai";
import { resolveAiModel } from "@/lib/ai-provider.server";

export type SyntheticField = {
  key: string;
  display_name?: string;
  data_type?: string;
  bucket?: string;
  description?: string;
};

export type SyntheticRecordDraft = {
  title: string;
  summary: string;
  values: { field_key: string; value: string }[];
};

const SYSTEM = `You fabricate SYNTHETIC training examples for a document data-labeling platform.
Everything you produce is artificial: never reuse real companies, real people, real account numbers or any real personal data.
Return ONLY JSON: {"records":[{"title":"short synthetic document title","summary":"one sentence describing the scenario","values":[{"field_key":"...","value":"..."}]}]}
Rules: one entry per requested field key for every record, no extra keys. Values must be realistic in format for the given data type (dates ISO-8601, currency with a code, identifiers plausibly formatted). Make each record meaningfully different from the others. No markdown fences.`;

function parseRecords(raw: string, fields: SyntheticField[], count: number): SyntheticRecordDraft[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let list: unknown = [];
  if (start !== -1 && end !== -1) {
    try {
      list = (JSON.parse(cleaned.slice(start, end + 1)) as { records?: unknown })?.records ?? [];
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];

  return list.slice(0, count).map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const rawValues = Array.isArray(row["values"]) ? (row["values"] as unknown[]) : [];
    const byKey = new Map<string, string>();
    for (const entry of rawValues) {
      const cell = (entry ?? {}) as Record<string, unknown>;
      const key = String(cell["field_key"] ?? "").trim();
      if (key) byKey.set(key, String(cell["value"] ?? "").slice(0, 2000));
    }
    return {
      title: String(row["title"] ?? `Synthetic record ${index + 1}`).slice(0, 160),
      summary: String(row["summary"] ?? "").slice(0, 400),
      values: fields.map((field) => ({
        field_key: field.key,
        value: byKey.get(field.key) ?? "",
      })),
    };
  });
}

export async function generateSyntheticDrafts(input: {
  /** An already-resolved AI SDK model — the caller resolves the profile's
   *  chosen provider/model (or the active default) before calling. */
  model: ReturnType<typeof resolveAiModel>;
  documentType: string;
  industry: string;
  profileName: string;
  fields: SyntheticField[];
  count: number;
  constraints: string;
  existingTitles: string[];
}): Promise<SyntheticRecordDraft[]> {
  const schema = input.fields
    .map(
      (field) =>
        `- ${field.key} (${field.data_type ?? "text"}) — ${field.display_name ?? field.key}${
          field.description ? `: ${field.description}` : ""
        }`,
    )
    .join("\n");

  const result = await generateText({
    model: input.model,
    system: SYSTEM,
    prompt: `Industry: ${input.industry || "general"}.
Document type: "${input.documentType || input.profileName}".
Generate ${input.count} synthetic record(s).

Fields:
${schema}

${
  input.constraints.trim()
    ? `Variation constraints from the user (follow them closely):\n${input.constraints.trim()}`
    : "No extra constraints; vary the scenarios naturally."
}

${
  input.existingTitles.length > 0
    ? `Avoid repeating these already-generated scenarios: ${input.existingTitles.slice(0, 25).join("; ")}`
    : ""
}`,
  });

  return parseRecords(result.text, input.fields, input.count);
}
