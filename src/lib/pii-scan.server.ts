import { generateText } from "ai";
import type { resolveAiModel } from "@/lib/ai-provider.server";

/**
 * Automatic PII detection for already-extracted field values.
 *
 * This is separate from the label profile's manual "Sensitive" toggle
 * (src/lib/redact.ts's sensitiveKeySet) — that flag says "this field key is
 * ALWAYS sensitive on every document using this profile", set ahead of time
 * by a human. This scan instead asks, per document: "does what the AI
 * actually extracted for this field look like personal data?" A free-text
 * "Notes" field might be blank on one invoice and contain someone's home
 * address on the next — the profile-level flag can't tell the difference,
 * this scan can. The two signals are combined (OR'd) everywhere masking
 * decisions are made; neither alone is the full picture.
 *
 * Modeled on the same idea as the old app's Presidio-based PII scanning
 * (server-side, automatic, per-document), but implemented as an AI call
 * instead of a dedicated NER library, since this codebase has no Python
 * runtime — it reuses the same OpenAI/Gemini connection prelabeling
 * already uses rather than standing up a separate service.
 */

export const PII_ENTITY_TYPES = [
  "person_name",
  "email",
  "phone",
  "address",
  "national_id",
  "financial_account",
  "date_of_birth",
  "health_info",
  "other_sensitive",
] as const;

export type PiiEntityType = (typeof PII_ENTITY_TYPES)[number];

export type PiiScanInput = { field_key: string; value: string };
export type PiiScanResult = { field_key: string; pii_detected: boolean; pii_types: PiiEntityType[] };

const SYSTEM = `You detect personally identifiable or otherwise sensitive information (PII) in already-extracted document field values. You are not extracting data — every value is given to you already; you only classify it.
Return ONLY a JSON object: {"findings":[{"field_key":"...","pii_detected":true|false,"pii_types":["person_name"]}]}
Allowed pii_types values (use only these): ${PII_ENTITY_TYPES.join(", ")}.
Rules: one entry per field_key given. A value that is a business/document identifier rather than personal data (an invoice number, a company name, a generic date, a line-item description, a dollar amount) is NOT PII. A person's name, a home address, a personal email or phone number, a national ID/SSN/passport/tax ID number, a bank account or card number, a date of birth, or health information IS PII. When unsure, prefer pii_detected:false — false positives mask data reviewers need to see. No markdown fences, no commentary.`;

function parseFindings(raw: string, inputs: PiiScanInput[]): PiiScanResult[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let list: unknown = [];
  if (start !== -1 && end !== -1) {
    try {
      list = (JSON.parse(cleaned.slice(start, end + 1)) as { findings?: unknown })?.findings ?? [];
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
  const allowed = new Set<string>(PII_ENTITY_TYPES);
  return inputs.map((input) => {
    const row = byKey.get(input.field_key);
    const types = Array.isArray(row?.["pii_types"])
      ? (row!["pii_types"] as unknown[])
          .map((entry) => String(entry).trim())
          .filter((entry): entry is PiiEntityType => allowed.has(entry))
      : [];
    return {
      field_key: input.field_key,
      pii_detected: Boolean(row?.["pii_detected"]) || types.length > 0,
      pii_types: types,
    };
  });
}

/**
 * Scans a batch of already-extracted field values for likely PII, using the
 * same resolved AI model prelabeling used for extraction on that document.
 * Best-effort: any failure (bad JSON, provider error, timeout) yields
 * "not detected" for every field rather than blocking or failing
 * prelabeling — this is an enhancement on top of extraction, not a
 * precondition for it.
 */
export async function scanForPii(
  model: ReturnType<typeof resolveAiModel>,
  inputs: PiiScanInput[],
): Promise<PiiScanResult[]> {
  const withValues = inputs.filter((input) => input.value.trim().length > 0);
  if (withValues.length === 0) {
    return inputs.map((input) => ({ field_key: input.field_key, pii_detected: false, pii_types: [] }));
  }
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: `Field values to classify:\n${withValues
        .map((input) => `- ${input.field_key}: ${input.value.slice(0, 500)}`)
        .join("\n")}`,
    });
    const found = parseFindings(result.text, withValues);
    const byKey = new Map(found.map((finding) => [finding.field_key, finding]));
    return inputs.map(
      (input) => byKey.get(input.field_key) ?? { field_key: input.field_key, pii_detected: false, pii_types: [] },
    );
  } catch {
    return inputs.map((input) => ({ field_key: input.field_key, pii_detected: false, pii_types: [] }));
  }
}
