import type { SupabaseClient } from "@supabase/supabase-js";

import {
  draftCorrectionReasons,
  draftPreferenceCandidates,
  type PreferenceDraft,
  type ReasonDraft,
} from "./reward-ai.server";
import { resolveModelConfig } from "./ai-provider.server";

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
  if (batch?.label_profile_id) {
    const { data: profile } = await supabase
      .from("label_profiles")
      .select("document_type, model_config")
      .eq("id", batch.label_profile_id)
      .maybeSingle();
    documentType = profile?.document_type ?? "";
    modelConfig = profile?.model_config ?? null;
  }

  return {
    documentType,
    documentText: doc.extracted_text ?? "",
    model: resolveModelConfig(modelConfig),
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
  const { model } = await loadDocumentContext(supabase, documentId);

  const { data: extractions, error } = await supabase
    .from("extractions")
    .select("field_key, field_label, data_type, suggested_value, final_value, evidence_snippet, reason_code")
    .eq("document_id", documentId)
    .eq("review_state", "corrected");
  if (error) throw new Error(error.message);

  const pending = (extractions ?? []).filter((row) => !row.reason_code);
  if (pending.length === 0) return { items: [] };

  const items = await draftCorrectionReasons({
    model,
    fields: pending.map((row) => ({
      key: row.field_key,
      label: row.field_label ?? row.field_key,
      dataType: row.data_type,
      suggested: row.suggested_value ?? "",
      corrected: row.final_value ?? "",
      evidence: row.evidence_snippet ?? "",
    })),
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
  const { documentType, documentText, model } = await loadDocumentContext(supabase, documentId);

  const { data: extractions, error } = await supabase
    .from("extractions")
    .select("field_key, field_label, data_type, suggested_value, final_value, evidence_snippet")
    .eq("document_id", documentId);
  if (error) throw new Error(error.message);
  if (!extractions || extractions.length === 0) return { items: [] };

  const items = await draftPreferenceCandidates({
    model,
    documentType,
    documentText,
    fields: extractions.map((row) => ({
      key: row.field_key,
      label: row.field_label ?? row.field_key,
      dataType: row.data_type,
      modelAValue: row.final_value ?? row.suggested_value ?? "",
      evidence: row.evidence_snippet ?? "",
    })),
  });
  return { items };
}
