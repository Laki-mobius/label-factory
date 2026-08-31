import type { SupabaseClient } from "@supabase/supabase-js";

import {
  draftCorrectionReasons,
  draftPreferenceCandidates,
  type PreferenceDraft,
  type ReasonDraft,
} from "./reward-ai.server";
import { resolveModelConfig } from "./ai-provider.server";
import { isSensitiveValue, maskForExport, redactSensitiveSpansFromText, sensitiveKeySet } from "./redact";

/**
 * Both Reward AI drafting calls send field values (and, for the preference
 * candidate draft, the whole document's extracted text) to a third-party
 * LLM — the same trust boundary as RLHF exports and the benchmark eval call.
 * Until now NEITHER draft masked anything at all, not even the label
 * profile's manual Sensitive flag; this was the one export/third-party path
 * the original redaction pass missed. Fixed here using the same
 * isSensitiveValue combination (profile flag OR this document's
 * pii_detected) as everywhere else, plus maskForExport for full,
 * irreversible redaction — there's no reviewer screen here to pair a
 * reveal toggle with.
 */
async function loadDocumentContext(supabase: SupabaseClient<any>, documentId: string) {
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, batch_id, extracted_text")
    .eq("id", documentId)
    .maybeSingle();
  if (docError) throw new Error(docError.message);
  if (!doc) throw new Error("Document not found or you do not have access to it.");

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, label_profile_id")
    .eq("id", doc.batch_id)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);

  let documentType = "";
  let modelConfig: unknown = null;
  let sensitiveKeys = new Set<string>();
  if (batch?.label_profile_id) {
    const { data: profile } = await supabase
      .from("label_profiles")
      .select("document_type, model_config, fields")
      .eq("id", batch.label_profile_id)
      .maybeSingle();
    documentType = profile?.document_type ?? "";
    modelConfig = profile?.model_config ?? null;
    sensitiveKeys = sensitiveKeySet(profile?.fields);
  }

  return {
    documentType,
    documentText: doc.extracted_text ?? "",
    model: resolveModelConfig(modelConfig),
    sensitiveKeys,
  };
}

/**
 * Drafts correction-reason codes/notes for every corrected field on a
 * document that doesn't have one yet. Returns drafts only — nothing is
 * written until the reviewer confirms and saves them from the UI.
 */
export async function runFeedbackReward(
  supabase: SupabaseClient<any>,
  documentId: string,
): Promise<{ items: ReasonDraft[] }> {
  const { model, sensitiveKeys } = await loadDocumentContext(supabase, documentId);

  const { data: extractions, error } = await supabase
    .from("extractions")
    .select(
      "field_key, field_label, data_type, suggested_value, final_value, evidence_snippet, reason_code, pii_detected",
    )
    .eq("document_id", documentId)
    .eq("review_state", "corrected");
  if (error) throw new Error(error.message);

  const pending = (extractions ?? []).filter((row) => !row.reason_code);
  if (pending.length === 0) return { items: [] };

  const items = await draftCorrectionReasons({
    model,
    fields: pending.map((row) => {
      const sensitive = isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected);
      return {
        key: row.field_key,
        label: row.field_label ?? row.field_key,
        dataType: row.data_type,
        suggested: sensitive ? maskForExport(row.suggested_value) : (row.suggested_value ?? ""),
        corrected: sensitive ? maskForExport(row.final_value) : (row.final_value ?? ""),
        evidence: sensitive ? maskForExport(row.evidence_snippet) : (row.evidence_snippet ?? ""),
      };
    }),
  });
  return { items };
}

/**
 * Drafts a Model-B candidate value and a suggested preference decision for
 * every extracted field on a document. Returns drafts only — nothing is
 * written until the reviewer confirms and saves them from the UI.
 */
export async function runPreferenceReward(
  supabase: SupabaseClient<any>,
  documentId: string,
): Promise<{ items: PreferenceDraft[] }> {
  const { documentType, documentText, model, sensitiveKeys } = await loadDocumentContext(supabase, documentId);

  const { data: extractions, error } = await supabase
    .from("extractions")
    .select("field_key, field_label, data_type, suggested_value, final_value, evidence_snippet, pii_detected")
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
  if (!extractions || extractions.length === 0) return { items: [] };

  // The document text below is free prose, not a single field value — a
  // sensitive field's real value can also appear verbatim in the
  // surrounding context sent for grounding. Blank out every literal
  // occurrence of each already-known-sensitive value before it goes out.
  // This only catches values already flagged sensitive/pii_detected on this
  // document's own extractions, not other PII nobody extracted into a field.
  const sensitiveValues = extractions
    .filter((row) => isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected))
    .flatMap((row) => [row.suggested_value, row.final_value]);
  const safeDocumentText = redactSensitiveSpansFromText(documentText, sensitiveValues);

  const items = await draftPreferenceCandidates({
    model,
    documentType,
    documentText: safeDocumentText,
    fields: extractions.map((row) => {
      const sensitive = isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected);
      return {
        key: row.field_key,
        label: row.field_label ?? row.field_key,
        dataType: row.data_type,
        modelAValue: sensitive
          ? maskForExport(row.final_value ?? row.suggested_value)
          : (row.final_value ?? row.suggested_value ?? ""),
        evidence: sensitive ? maskForExport(row.evidence_snippet) : (row.evidence_snippet ?? ""),
      };
    }),
  });
  return { items };
}
