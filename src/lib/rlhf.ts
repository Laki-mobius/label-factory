import { supabase } from "@/integrations/supabase/client";
import { isSensitiveValue, maskForExport, sensitiveKeySet } from "@/lib/redact";

/**
 * A single human-feedback training pair: what the AI suggested for a field
 * versus what a human reviewer corrected it to during Annotate & Label.
 */
export type TrainingPair = {
  id: string;
  documentId: string;
  filename: string;
  batchId: string;
  batchName: string;
  profileId: string | null;
  profileLabel: string;
  fieldKey: string;
  fieldLabel: string;
  suggested: string;
  corrected: string;
  confidence: number | null;
  reviewedAt: string;
};

export type PairFilters = {
  batchIds?: string[] | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
};

/**
 * Loads corrected extractions for a project and shapes them into training pairs.
 * Corrections are the RLHF signal — accepted values carry no learning delta.
 */
export async function fetchTrainingPairs(
  projectId: string,
  filters: PairFilters = {},
): Promise<TrainingPair[]> {
  const { data: batches, error: batchError } = await supabase
    .from("batches")
    .select("id, name, label_profile_id")
    .eq("project_id", projectId);
  if (batchError) throw batchError;

  let batchRows = batches ?? [];
  if (filters.batchIds && filters.batchIds.length > 0) {
    batchRows = batchRows.filter((batch) => filters.batchIds!.includes(batch.id));
  }
  if (batchRows.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, version, fields")
    .eq("project_id", projectId);
  if (profileError) throw profileError;
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, `${profile.name} · v${profile.version}`]),
  );
  // Export path — corrections leave the reviewer's screen (CSV/JSON download,
  // or DPO/SFT training data), so sensitive fields get full irreversible
  // masking here rather than annotate.tsx's reversible on-screen masking.
  const sensitiveByProfile = new Map(
    (profiles ?? []).map((profile) => [profile.id, sensitiveKeySet(profile.fields)]),
  );

  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, filename, batch_id")
    .in(
      "batch_id",
      batchRows.map((batch) => batch.id),
    );
  if (documentError) throw documentError;
  if ((documents ?? []).length === 0) return [];

  const documentMap = new Map((documents ?? []).map((doc) => [doc.id, doc]));
  const batchMap = new Map(batchRows.map((batch) => [batch.id, batch]));

  let query = supabase
    .from("extractions")
    .select(
      "id, document_id, field_key, field_label, suggested_value, final_value, confidence, reviewed_at, review_state, pii_detected",
    )
    .in(
      "document_id",
      (documents ?? []).map((doc) => doc.id),
    )
    .eq("review_state", "corrected")
    .order("reviewed_at", { ascending: false })
    .limit(5000);

  if (filters.from) query = query.gte("reviewed_at", filters.from);
  if (filters.to) query = query.lte("reviewed_at", filters.to);

  const { data: extractions, error: extractionError } = await query;
  if (extractionError) throw extractionError;

  const pairs: TrainingPair[] = [];
  for (const row of extractions ?? []) {
    const doc = documentMap.get(row.document_id);
    if (!doc) continue;
    const batch = batchMap.get(doc.batch_id);
    if (!batch) continue;
    const corrected = row.final_value ?? "";
    const suggested = row.suggested_value ?? "";
    if (corrected === suggested) continue;

    const profileFlagged = batch.label_profile_id
      ? (sensitiveByProfile.get(batch.label_profile_id)?.has(row.field_key) ?? false)
      : false;
    const isSensitive = isSensitiveValue(profileFlagged, row.pii_detected);

    pairs.push({
      id: row.id,
      documentId: row.document_id,
      filename: doc.filename,
      batchId: batch.id,
      batchName: batch.name,
      profileId: batch.label_profile_id,
      profileLabel: batch.label_profile_id
        ? (profileMap.get(batch.label_profile_id) ?? "Unmapped profile")
        : "Unmapped profile",
      fieldKey: row.field_key,
      fieldLabel: row.field_label ?? row.field_key,
      suggested: isSensitive ? maskForExport(suggested) : suggested,
      corrected: isSensitive ? maskForExport(corrected) : corrected,
      confidence: row.confidence === null ? null : Number(row.confidence),
      reviewedAt: row.reviewed_at ?? "",
    });
  }
  return pairs;
}

export function groupCount<Item, T extends string>(items: Item[], pick: (item: Item) => T) {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(pick(item), (counts.get(pick(item)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Corrections review — explaining WHY a corrected field was wrong (SFT signal)
// ---------------------------------------------------------------------------

export const REASON_CODE_LABELS: Record<string, string> = {
  wrong_value: "Wrong value",
  partial_extraction: "Partial extraction",
  wrong_entity_mapping: "Wrong entity mapping",
  wrong_evidence_mapping: "Wrong evidence mapping",
  format_issue: "Format issue",
  other: "Other",
};

export type FeedbackQueueDoc = {
  documentId: string;
  filename: string;
  batchId: string;
  batchName: string;
  correctedCount: number;
  explainedCount: number;
};

/** Documents with at least one corrected field, and how many already have a reason recorded. */
export async function fetchFeedbackQueue(
  projectId: string,
  batchIds?: string[],
): Promise<FeedbackQueueDoc[]> {
  const { data: batches, error: batchError } = await supabase
    .from("batches")
    .select("id, name")
    .eq("project_id", projectId);
  if (batchError) throw batchError;
  const scoped = (batches ?? []).filter((batch) => !batchIds?.length || batchIds.includes(batch.id));
  if (scoped.length === 0) return [];
  const batchMap = new Map(scoped.map((batch) => [batch.id, batch.name]));

  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, filename, batch_id")
    .in("batch_id", scoped.map((batch) => batch.id));
  if (documentError) throw documentError;
  if (!documents || documents.length === 0) return [];
  const documentMap = new Map(documents.map((doc) => [doc.id, doc]));

  const { data: extractions, error: extractionError } = await supabase
    .from("extractions")
    .select("document_id, review_state, reason_code")
    .in("document_id", documents.map((doc) => doc.id))
    .eq("review_state", "corrected");
  if (extractionError) throw extractionError;

  const counts = new Map<string, { corrected: number; explained: number }>();
  for (const row of extractions ?? []) {
    const entry = counts.get(row.document_id) ?? { corrected: 0, explained: 0 };
    entry.corrected += 1;
    if (row.reason_code) entry.explained += 1;
    counts.set(row.document_id, entry);
  }

  const queue: FeedbackQueueDoc[] = [];
  for (const [documentId, entry] of counts) {
    if (entry.corrected === 0) continue;
    const doc = documentMap.get(documentId);
    if (!doc) continue;
    queue.push({
      documentId,
      filename: doc.filename,
      batchId: doc.batch_id,
      batchName: batchMap.get(doc.batch_id) ?? "Unknown batch",
      correctedCount: entry.corrected,
      explainedCount: entry.explained,
    });
  }
  return queue.sort((a, b) => a.filename.localeCompare(b.filename));
}

/** Looks up whether a document's field_keys are marked `sensitive: true` on
 *  its batch's label profile — used so the interactive SFT/DPO review
 *  screens can reversibly mask a value on screen (see maskForDisplay in
 *  @/lib/redact), the same trust boundary as the Annotate & Label screen. */
async function sensitiveKeysForDocument(documentId: string): Promise<Set<string>> {
  const { data: doc } = await supabase
    .from("documents")
    .select("batch_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc?.batch_id) return new Set();
  const { data: batch } = await supabase
    .from("batches")
    .select("label_profile_id")
    .eq("id", doc.batch_id)
    .maybeSingle();
  if (!batch?.label_profile_id) return new Set();
  const { data: profile } = await supabase
    .from("label_profiles")
    .select("fields")
    .eq("id", batch.label_profile_id)
    .maybeSingle();
  return sensitiveKeySet(profile?.fields);
}

export type FeedbackFieldRow = {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  suggestedValue: string;
  correctedValue: string;
  confidence: number | null;
  evidenceSnippet: string;
  reasonCode: string | null;
  reasonNotes: string;
  /** True when this field is marked Sensitive on the label profile — the
   *  review screen shows it masked by default with a per-viewer reveal toggle. */
  sensitive: boolean;
};

export async function fetchFeedbackDocument(documentId: string): Promise<FeedbackFieldRow[]> {
  const [{ data, error }, sensitiveKeys] = await Promise.all([
    supabase
      .from("extractions")
      .select(
        "id, field_key, field_label, suggested_value, final_value, confidence, evidence_snippet, reason_code, reason_notes, pii_detected",
      )
      .eq("document_id", documentId)
      .eq("review_state", "corrected")
      .order("field_key", { ascending: true }),
    sensitiveKeysForDocument(documentId),
  ]);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    fieldKey: row.field_key,
    fieldLabel: row.field_label ?? row.field_key,
    suggestedValue: row.suggested_value ?? "",
    correctedValue: row.final_value ?? "",
    confidence: row.confidence === null ? null : Number(row.confidence),
    evidenceSnippet: row.evidence_snippet ?? "",
    reasonCode: row.reason_code,
    reasonNotes: row.reason_notes ?? "",
    sensitive: isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected),
  }));
}

export async function saveFeedbackDocument(
  rows: Array<{ id: string; reasonCode: string; reasonNotes: string }>,
): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      supabase
        .from("extractions")
        .update({ reason_code: row.reasonCode as never, reason_notes: row.reasonNotes || null })
        .eq("id", row.id)
        .then(({ error }) => {
          if (error) throw error;
        }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Preference / DPO comparison — Model A (current output) vs Model B (candidate)
// ---------------------------------------------------------------------------

export type PreferenceQueueDoc = {
  documentId: string;
  filename: string;
  batchId: string;
  batchName: string;
  fieldCount: number;
  decidedCount: number;
};

export async function fetchPreferenceQueue(
  projectId: string,
  batchIds?: string[],
): Promise<PreferenceQueueDoc[]> {
  const { data: batches, error: batchError } = await supabase
    .from("batches")
    .select("id, name")
    .eq("project_id", projectId);
  if (batchError) throw batchError;
  const scoped = (batches ?? []).filter((batch) => !batchIds?.length || batchIds.includes(batch.id));
  if (scoped.length === 0) return [];
  const batchMap = new Map(scoped.map((batch) => [batch.id, batch.name]));

  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, filename, batch_id")
    .in("batch_id", scoped.map((batch) => batch.id));
  if (documentError) throw documentError;
  if (!documents || documents.length === 0) return [];
  const documentMap = new Map(documents.map((doc) => [doc.id, doc]));
  const documentIds = documents.map((doc) => doc.id);

  const { data: extractions, error: extractionError } = await supabase
    .from("extractions")
    .select("document_id")
    .in("document_id", documentIds)
    .not("suggested_value", "is", null);
  if (extractionError) throw extractionError;

  const { data: decisions, error: decisionError } = await supabase
    .from("rlhf_preference_decisions")
    .select("document_id, decision")
    .in("document_id", documentIds);
  if (decisionError) throw decisionError;

  const fieldCounts = new Map<string, number>();
  for (const row of extractions ?? []) {
    fieldCounts.set(row.document_id, (fieldCounts.get(row.document_id) ?? 0) + 1);
  }
  const decidedCounts = new Map<string, number>();
  for (const row of decisions ?? []) {
    if (!row.decision) continue;
    decidedCounts.set(row.document_id, (decidedCounts.get(row.document_id) ?? 0) + 1);
  }

  const queue: PreferenceQueueDoc[] = [];
  for (const [documentId, fieldCount] of fieldCounts) {
    if (fieldCount === 0) continue;
    const doc = documentMap.get(documentId);
    if (!doc) continue;
    queue.push({
      documentId,
      filename: doc.filename,
      batchId: doc.batch_id,
      batchName: batchMap.get(doc.batch_id) ?? "Unknown batch",
      fieldCount,
      decidedCount: decidedCounts.get(documentId) ?? 0,
    });
  }
  return queue.sort((a, b) => a.filename.localeCompare(b.filename));
}

export const PREFERENCE_DECISION_LABELS: Record<string, string> = {
  prefer_a: "Prefer A",
  prefer_b: "Prefer B",
  both: "Both correct",
  neither: "Neither correct",
};

export type PreferenceFieldRow = {
  fieldKey: string;
  fieldLabel: string;
  modelAValue: string;
  modelBValue: string;
  decision: "prefer_a" | "prefer_b" | "both" | "neither" | null;
  evidenceSnippet: string;
  /** True when this field is marked Sensitive on the label profile — the
   *  review screen shows it masked by default with a per-viewer reveal toggle. */
  sensitive: boolean;
};

export async function fetchPreferenceDocument(documentId: string): Promise<PreferenceFieldRow[]> {
  const [{ data: extractions, error: extractionError }, sensitiveKeys] = await Promise.all([
    supabase
      .from("extractions")
      .select("field_key, field_label, suggested_value, final_value, evidence_snippet, pii_detected")
      .eq("document_id", documentId)
      .order("field_key", { ascending: true }),
    sensitiveKeysForDocument(documentId),
  ]);
  if (extractionError) throw extractionError;

  const { data: decisions, error: decisionError } = await supabase
    .from("rlhf_preference_decisions")
    .select("field_key, model_b_value, decision")
    .eq("document_id", documentId);
  if (decisionError) throw decisionError;
  const decisionMap = new Map((decisions ?? []).map((row) => [row.field_key, row]));

  return (extractions ?? [])
    .filter((row) => row.suggested_value !== null)
    .map((row) => {
      const decision = decisionMap.get(row.field_key);
      return {
        fieldKey: row.field_key,
        fieldLabel: row.field_label ?? row.field_key,
        modelAValue: row.final_value ?? row.suggested_value ?? "",
        modelBValue: decision?.model_b_value ?? "",
        decision: (decision?.decision ?? null) as PreferenceFieldRow["decision"],
        evidenceSnippet: row.evidence_snippet ?? "",
        // Model B is an alternate candidate for the same field, not a
        // separately-scanned value, so it inherits this field's PII status
        // from Model A's own extraction row rather than being scanned itself.
        sensitive: isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected),
      };
    });
}

export async function savePreferenceDocument(
  documentId: string,
  rows: Array<{
    fieldKey: string;
    fieldLabel: string;
    modelAValue: string;
    modelBValue: string;
    decision: "prefer_a" | "prefer_b" | "both" | "neither";
  }>,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("rlhf_preference_decisions").upsert(
    rows.map((row) => ({
      document_id: documentId,
      field_key: row.fieldKey,
      field_label: row.fieldLabel,
      model_a_value: row.modelAValue,
      model_b_value: row.modelBValue,
      decision: row.decision as never,
      decided_by: auth.user?.id ?? null,
      decided_at: now,
    })),
    { onConflict: "document_id,field_key" },
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Export readiness
// ---------------------------------------------------------------------------

export type RlhfReadiness = {
  sftReadyCount: number;
  dpoReadyCount: number;
  correctedTotal: number;
  preferenceFieldTotal: number;
};

export async function fetchRlhfReadiness(
  projectId: string,
  batchIds?: string[],
): Promise<RlhfReadiness> {
  const [feedback, preference] = await Promise.all([
    fetchFeedbackQueue(projectId, batchIds),
    fetchPreferenceQueue(projectId, batchIds),
  ]);
  return {
    sftReadyCount: feedback.filter((doc) => doc.explainedCount === doc.correctedCount).length,
    dpoReadyCount: preference.filter((doc) => doc.decidedCount === doc.fieldCount).length,
    correctedTotal: feedback.reduce((sum, doc) => sum + doc.correctedCount, 0),
    preferenceFieldTotal: preference.reduce((sum, doc) => sum + doc.fieldCount, 0),
  };
}

export type ExportFormat = "jsonl" | "json" | "dpo_jsonl" | "csv";

/** Fine-tuning-ready records: prompt describes the field, completion is the human value. */
export function buildExportRecords(pairs: TrainingPair[]) {
  return pairs.map((pair) => ({
    field_key: pair.fieldKey,
    field_label: pair.fieldLabel,
    document: pair.filename,
    batch: pair.batchName,
    profile: pair.profileLabel,
    messages: [
      {
        role: "system",
        content: `Extract the field "${pair.fieldLabel}" from the document and return only its value.`,
      },
      { role: "user", content: `Document: ${pair.filename}\nField: ${pair.fieldLabel}` },
      { role: "assistant", content: pair.corrected },
    ],
    rejected: pair.suggested,
    chosen: pair.corrected,
    model_confidence: pair.confidence,
    reviewed_at: pair.reviewedAt,
  }));
}

export function serializeExport(records: ReturnType<typeof buildExportRecords>, format: ExportFormat) {
  return format === "jsonl"
    ? records.map((record) => JSON.stringify(record)).join("\n")
    : JSON.stringify(records, null, 2);
}

export function serializeCsv(pairs: TrainingPair[]): string {
  const header = ["document", "batch", "profile", "field_key", "field_label", "suggested", "corrected", "confidence", "reviewed_at"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = pairs.map((pair) =>
    [
      pair.filename,
      pair.batchName,
      pair.profileLabel,
      pair.fieldKey,
      pair.fieldLabel,
      pair.suggested,
      pair.corrected,
      pair.confidence ?? "",
      pair.reviewedAt,
    ]
      .map((value) => escape(String(value)))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export type PreferencePair = {
  documentId: string;
  filename: string;
  batchName: string;
  profileLabel: string;
  fieldKey: string;
  fieldLabel: string;
  modelAValue: string;
  modelBValue: string;
  decision: "prefer_a" | "prefer_b" | "both" | "neither";
  decidedAt: string;
};

/** Loads decided preference rows for a project, joined with batch/profile/document context. */
export async function fetchPreferencePairs(
  projectId: string,
  filters: PairFilters = {},
): Promise<PreferencePair[]> {
  const { data: batches, error: batchError } = await supabase
    .from("batches")
    .select("id, name, label_profile_id")
    .eq("project_id", projectId);
  if (batchError) throw batchError;
  let batchRows = batches ?? [];
  if (filters.batchIds && filters.batchIds.length > 0) {
    batchRows = batchRows.filter((batch) => filters.batchIds!.includes(batch.id));
  }
  if (batchRows.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, version, fields")
    .eq("project_id", projectId);
  if (profileError) throw profileError;
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, `${profile.name} · v${profile.version}`]),
  );
  const sensitiveByProfile = new Map(
    (profiles ?? []).map((profile) => [profile.id, sensitiveKeySet(profile.fields)]),
  );

  const { data: documents, error: documentError } = await supabase
    .from("documents")
    .select("id, filename, batch_id")
    .in("batch_id", batchRows.map((batch) => batch.id));
  if (documentError) throw documentError;
  if (!documents || documents.length === 0) return [];
  const documentMap = new Map(documents.map((doc) => [doc.id, doc]));
  const batchMap = new Map(batchRows.map((batch) => [batch.id, batch]));

  // rlhf_preference_decisions doesn't carry its own PII-scan result — look
  // it up from the matching extraction row (document_id + field_key), the
  // same automatic per-document signal used everywhere else in this file.
  const { data: piiRows, error: piiError } = await supabase
    .from("extractions")
    .select("document_id, field_key, pii_detected")
    .in(
      "document_id",
      documents.map((doc) => doc.id),
    );
  if (piiError) throw piiError;
  const piiByDocField = new Map(
    (piiRows ?? []).map((row) => [`${row.document_id}:${row.field_key}`, row.pii_detected]),
  );

  let query = supabase
    .from("rlhf_preference_decisions")
    .select("document_id, field_key, field_label, model_a_value, model_b_value, decision, decided_at")
    .in("document_id", documents.map((doc) => doc.id))
    .not("decision", "is", null)
    .order("decided_at", { ascending: false })
    .limit(5000);
  if (filters.from) query = query.gte("decided_at", filters.from);
  if (filters.to) query = query.lte("decided_at", filters.to);

  const { data: decisions, error: decisionError } = await query;
  if (decisionError) throw decisionError;

  const pairs: PreferencePair[] = [];
  for (const row of decisions ?? []) {
    const doc = documentMap.get(row.document_id);
    if (!doc) continue;
    const batch = batchMap.get(doc.batch_id);
    if (!batch) continue;
    const profileFlagged = batch.label_profile_id
      ? (sensitiveByProfile.get(batch.label_profile_id)?.has(row.field_key) ?? false)
      : false;
    const isSensitive = isSensitiveValue(
      profileFlagged,
      piiByDocField.get(`${row.document_id}:${row.field_key}`),
    );
    pairs.push({
      documentId: row.document_id,
      filename: doc.filename,
      batchName: batch.name,
      profileLabel: batch.label_profile_id
        ? (profileMap.get(batch.label_profile_id) ?? "Unmapped profile")
        : "Unmapped profile",
      fieldKey: row.field_key,
      fieldLabel: row.field_label ?? row.field_key,
      modelAValue: isSensitive ? maskForExport(row.model_a_value ?? "") : (row.model_a_value ?? ""),
      modelBValue: isSensitive ? maskForExport(row.model_b_value ?? "") : (row.model_b_value ?? ""),
      decision: row.decision as PreferencePair["decision"],
      decidedAt: row.decided_at ?? "",
    });
  }
  return pairs;
}

/** DPO-ready records: chosen vs rejected completion, skipping ties ("both"/"neither"). */
export function buildDpoRecords(pairs: PreferencePair[]) {
  return pairs
    .filter((pair) => pair.decision === "prefer_a" || pair.decision === "prefer_b")
    .map((pair) => {
      const chosen = pair.decision === "prefer_a" ? pair.modelAValue : pair.modelBValue;
      const rejected = pair.decision === "prefer_a" ? pair.modelBValue : pair.modelAValue;
      return {
        field_key: pair.fieldKey,
        field_label: pair.fieldLabel,
        document: pair.filename,
        batch: pair.batchName,
        profile: pair.profileLabel,
        prompt: `Extract the field "${pair.fieldLabel}" from the document and return only its value.`,
        chosen,
        rejected,
        decided_at: pair.decidedAt,
      };
    });
}
