import { generateText } from "ai";
import { resolveAiModel } from "@/lib/ai-provider.server";

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export const REASON_CODES = [
  "wrong_value",
  "partial_extraction",
  "wrong_entity_mapping",
  "wrong_evidence_mapping",
  "format_issue",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonDraft = { field_key: string; reason_code: ReasonCode; reason_notes: string };

const FEEDBACK_SYSTEM = `You assist a human reviewer explaining why an AI-extracted field value needed correcting.
For each field you are given the AI's suggested value and the human-corrected value.
Classify the correction using EXACTLY one of these reason codes: ${REASON_CODES.join(", ")}.
Also write one short, specific sentence explaining the correction (reason_notes).
Return ONLY JSON: {"items":[{"field_key":"...","reason_code":"...","reason_notes":"..."}]}
One entry per field key given, no extras, no markdown fences.`;

export async function draftCorrectionReasons(input: {
  /** An already-resolved AI SDK model — the caller resolves the mapped label
   *  profile's chosen provider/model (or the active default) before calling. */
  model: ReturnType<typeof resolveAiModel>;
  fields: Array<{
    key: string;
    label: string;
    dataType: string;
    suggested: string;
    corrected: string;
    evidence: string;
  }>;
}): Promise<ReasonDraft[]> {
  const schema = input.fields
    .map(
      (field) =>
        `- ${field.key} (${field.dataType}) "${field.label}": AI suggested "${field.suggested}", human corrected to "${field.corrected}". Evidence: "${field.evidence.slice(0, 300)}"`,
    )
    .join("\n");

  const result = await generateText({
    model: input.model,
    system: FEEDBACK_SYSTEM,
    prompt: `Corrections to explain:\n${schema}`,
  });

  const parsed = extractJson(result.text) as { items?: unknown } | null;
  const list = Array.isArray(parsed?.items) ? parsed!.items : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    const row = item as Record<string, unknown>;
    const key = String(row["field_key"] ?? "").trim();
    if (key) byKey.set(key, row);
  }
  return input.fields.map((field) => {
    const row = byKey.get(field.key);
    const code = String(row?.["reason_code"] ?? "");
    return {
      field_key: field.key,
      reason_code: (REASON_CODES as readonly string[]).includes(code)
        ? (code as ReasonCode)
        : "other",
      reason_notes: String(row?.["reason_notes"] ?? "").slice(0, 500),
    };
  });
}

export const PREFERENCE_DECISIONS = ["prefer_a", "prefer_b", "both", "neither"] as const;
export type PreferenceDecisionValue = (typeof PREFERENCE_DECISIONS)[number];

export type PreferenceDraft = {
  field_key: string;
  model_b_value: string;
  decision: PreferenceDecisionValue;
};

const PREFERENCE_SYSTEM = `You assist a human reviewer building a preference (DPO) dataset from document field extractions.
Model A already produced a value for each field, given below with a supporting evidence snippet from the source document.
Read the document context and, acting as an independent "Model B", propose a genuinely different but plausible alternative value for each field where one exists (e.g. an adjacent entity, alternate formatting, or a truncated/expanded reading). If Model A's value already looks correct and you cannot find a reasonable alternative, return an empty string for model_b_value.
Then judge which is better: "prefer_a", "prefer_b", "both" (both equally correct), or "neither" (both wrong).
Return ONLY JSON: {"items":[{"field_key":"...","model_b_value":"...","decision":"..."}]}
One entry per field key given, no extras, no markdown fences.`;

export async function draftPreferenceCandidates(input: {
  model: ReturnType<typeof resolveAiModel>;
  documentType: string;
  documentText: string;
  fields: Array<{ key: string; label: string; dataType: string; modelAValue: string; evidence: string }>;
}): Promise<PreferenceDraft[]> {
  const schema = input.fields
    .map(
      (field) =>
        `- ${field.key} (${field.dataType}) "${field.label}": Model A value = "${field.modelAValue}". Evidence: "${field.evidence.slice(0, 300)}"`,
    )
    .join("\n");

  const result = await generateText({
    model: input.model,
    system: PREFERENCE_SYSTEM,
    prompt: `Document type: "${input.documentType || "unknown"}"

Fields:
${schema}

--- DOCUMENT CONTEXT (truncated) ---
${input.documentText.slice(0, 20000)}
--- END ---`,
  });

  const parsed = extractJson(result.text) as { items?: unknown } | null;
  const list = Array.isArray(parsed?.items) ? parsed!.items : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    const row = item as Record<string, unknown>;
    const key = String(row["field_key"] ?? "").trim();
    if (key) byKey.set(key, row);
  }
  return input.fields.map((field) => {
    const row = byKey.get(field.key);
    const decision = String(row?.["decision"] ?? "");
    return {
      field_key: field.key,
      model_b_value: String(row?.["model_b_value"] ?? "").slice(0, 2000),
      decision: (PREFERENCE_DECISIONS as readonly string[]).includes(decision)
        ? (decision as PreferenceDecisionValue)
        : "neither",
    };
  });
}
