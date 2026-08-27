import { supabase } from "@/integrations/supabase/client";

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
  batchIds?: string[];
  from?: string | null;
  to?: string | null;
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
    .select("id, name, version")
    .eq("project_id", projectId);
  if (profileError) throw profileError;
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, `${profile.name} · v${profile.version}`]),
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
      "id, document_id, field_key, field_label, suggested_value, final_value, confidence, reviewed_at, review_state",
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
      suggested,
      corrected,
      confidence: row.confidence === null ? null : Number(row.confidence),
      reviewedAt: row.reviewed_at ?? "",
    });
  }
  return pairs;
}

export function groupCount<T extends string>(pairs: TrainingPair[], pick: (pair: TrainingPair) => T) {
  const counts = new Map<T, number>();
  for (const pair of pairs) counts.set(pick(pair), (counts.get(pick(pair)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export type ExportFormat = "jsonl" | "json";

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
