import type { SupabaseClient } from "@supabase/supabase-js";

import { extractValues, type ProfileField } from "./prelabel.server";
import {
  resolveAiModel,
  resolveExplicitModel,
  type BenchmarkModelChoice,
} from "./ai-provider.server";
import { classifyComparisons, type FieldResult } from "./field-match";

type ApprovedDoc = {
  id: string;
  filename: string;
  batch_id: string;
  extracted_text: string | null;
};

type GroundTruthRow = {
  document_id: string;
  field_key: string;
  final_value: string | null;
  review_state: string;
};

async function loadApprovedDocsWithGroundTruth(supabase: SupabaseClient<any>, batchId: string) {
  const { data: documents, error: docErr } = await supabase
    .from("documents")
    .select("id, filename, batch_id, extracted_text, status")
    .eq("batch_id", batchId)
    .eq("status", "approved");
  if (docErr) throw new Error(docErr.message);

  const docs = (documents ?? []).filter(
    (doc) => (doc.extracted_text ?? "").trim().length > 0,
  ) as ApprovedDoc[];
  if (docs.length === 0) {
    throw new Error(
      "No approved documents with extracted text in this batch yet. Approve some documents first.",
    );
  }

  const { data: extractions, error: exErr } = await supabase
    .from("extractions")
    .select("document_id, field_key, final_value, review_state")
    .in(
      "document_id",
      docs.map((doc) => doc.id),
    );
  if (exErr) throw new Error(exErr.message);

  const groundTruthByDoc = new Map<string, GroundTruthRow[]>();
  for (const row of (extractions ?? []) as GroundTruthRow[]) {
    const list = groundTruthByDoc.get(row.document_id) ?? [];
    list.push(row);
    groundTruthByDoc.set(row.document_id, list);
  }

  return { docs, groundTruthByDoc };
}

export type ComparisonRunOutput = {
  runId: string;
  modelKey: string;
  modelLabel: string;
  overall: number;
  documentsEvaluated: number;
  comparisons: number;
  fields: FieldResult[];
};

async function persistComparisonRun(
  supabase: SupabaseClient<any>,
  userId: string,
  opts: {
    projectId: string;
    name: string;
    profileIds: string[];
    batchIds: string[];
    profileLabels: string[];
    batchLabels: string[];
    modelKey: string;
    modelLabel: string;
    comparisonGroupId: string;
    benchmarkMode: "model" | "schema";
    fieldResults: FieldResult[];
    overall: number;
    documentsEvaluated: number;
    comparisons: number;
  },
): Promise<ComparisonRunOutput> {
  const { data: run, error: runError } = await supabase
    .from("benchmark_runs")
    .insert({
      project_id: opts.projectId,
      name: opts.name,
      profile_ids: opts.profileIds,
      batch_ids: opts.batchIds,
      profile_labels: opts.profileLabels,
      batch_labels: opts.batchLabels,
      overall_score: opts.overall,
      documents_evaluated: opts.documentsEvaluated,
      fields_evaluated: opts.fieldResults.length,
      comparisons: opts.comparisons,
      model_key: opts.modelKey,
      model_label: opts.modelLabel,
      comparison_group_id: opts.comparisonGroupId,
      benchmark_mode: opts.benchmarkMode,
      created_by: userId,
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  if (opts.fieldResults.length > 0) {
    const { error: fieldError } = await supabase.from("benchmark_field_results").insert(
      opts.fieldResults.map((field) => ({
        run_id: run.id,
        field_key: field.field_key,
        field_label: field.field_label,
        total: field.total,
        matched: field.matched,
        near_matched: field.near_matched,
        missed: field.missed,
        rejected: field.rejected,
        match_rate: field.match_rate,
        precision_score: field.precision_score,
        recall_score: field.recall_score,
        failure_pattern: field.failure_pattern,
        mismatches: field.mismatches as unknown as never,
      })),
    );
    if (fieldError) throw new Error(fieldError.message);
  }

  return {
    runId: run.id as string,
    modelKey: opts.modelKey,
    modelLabel: opts.modelLabel,
    overall: opts.overall,
    documentsEvaluated: opts.documentsEvaluated,
    comparisons: opts.comparisons,
    fields: opts.fieldResults,
  };
}

async function extractAndCompare(
  model: ReturnType<typeof resolveAiModel>,
  documentType: string,
  fields: ProfileField[],
  docs: ApprovedDoc[],
  groundTruthByDoc: Map<string, GroundTruthRow[]>,
) {
  const rows: Array<{
    field_key: string;
    field_label: string | null;
    suggested_value: string | null;
    final_value: string | null;
    review_state: string;
    document_id: string;
    filename: string;
    batch_id: string;
  }> = [];

  for (const doc of docs) {
    const extracted = await extractValues({
      model,
      documentType,
      filename: doc.filename,
      text: doc.extracted_text ?? "",
      fields,
    });
    const extractedByKey = new Map(extracted.map((item) => [item.field_key, item.value]));
    const groundTruth = groundTruthByDoc.get(doc.id) ?? [];
    const gtByKey = new Map(groundTruth.map((row) => [row.field_key, row]));

    for (const field of fields) {
      const gt = gtByKey.get(field.key);
      rows.push({
        field_key: field.key,
        field_label: field.display_name ?? field.key,
        suggested_value: extractedByKey.get(field.key) ?? "",
        final_value: gt?.final_value ?? null,
        review_state: gt?.review_state ?? "pending",
        document_id: doc.id,
        filename: doc.filename,
        batch_id: doc.batch_id,
      });
    }
  }

  return classifyComparisons(rows);
}

/**
 * Compares 2-3 AI models on the SAME batch + label profile: re-runs
 * extraction with each model against every approved document's stored text,
 * then measures each against the human-approved final values. One
 * benchmark_runs row per model, all sharing a comparison_group_id.
 */
export async function runModelComparisonBenchmark(
  supabase: SupabaseClient<any>,
  userId: string,
  input: { projectId: string; batchId: string; profileId: string; models: BenchmarkModelChoice[] },
) {
  if (input.models.length < 2 || input.models.length > 3) {
    throw new Error("Pick 2 or 3 models to compare.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, version, document_type, fields")
    .eq("id", input.profileId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error("Label profile not found.");
  const fields = (Array.isArray(profile.fields) ? profile.fields : []) as ProfileField[];
  if (fields.length === 0) throw new Error("This label profile has no fields yet.");

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, name")
    .eq("id", input.batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error("Batch not found.");

  const { docs, groundTruthByDoc } = await loadApprovedDocsWithGroundTruth(supabase, input.batchId);

  const comparisonGroupId = crypto.randomUUID();
  const runs: ComparisonRunOutput[] = [];

  for (const choice of input.models) {
    const model = resolveExplicitModel(choice.provider, choice.modelId);
    const { fields: fieldResults, overall, comparisons } = await extractAndCompare(
      model,
      profile.document_type ?? "",
      fields,
      docs,
      groundTruthByDoc,
    );
    runs.push(
      await persistComparisonRun(supabase, userId, {
        projectId: input.projectId,
        name: `${choice.label} · ${batch.name}`,
        profileIds: [input.profileId],
        batchIds: [input.batchId],
        profileLabels: [`${profile.name} · v${profile.version}`],
        batchLabels: [batch.name],
        modelKey: `${choice.provider}:${choice.modelId}`,
        modelLabel: choice.label,
        comparisonGroupId,
        benchmarkMode: "model",
        fieldResults,
        overall,
        documentsEvaluated: docs.length,
        comparisons,
      }),
    );
  }

  return { comparisonGroupId, runs };
}

/**
 * Compares 2-3 versions of a label profile ("schema") on the SAME batch with
 * one fixed model (the active default provider): re-runs extraction using
 * each version's own field list, then measures against the human-approved
 * final values. One benchmark_runs row per profile version, all sharing a
 * comparison_group_id.
 */
export async function runSchemaComparisonBenchmark(
  supabase: SupabaseClient<any>,
  userId: string,
  input: { projectId: string; batchId: string; profileVersionIds: string[] },
) {
  if (input.profileVersionIds.length < 2 || input.profileVersionIds.length > 3) {
    throw new Error("Pick 2 or 3 profile versions to compare.");
  }

  const { data: profiles, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, version, document_type, fields")
    .in("id", input.profileVersionIds);
  if (profileError) throw new Error(profileError.message);
  if (!profiles || profiles.length !== input.profileVersionIds.length) {
    throw new Error("One or more selected profile versions could not be found.");
  }

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, name")
    .eq("id", input.batchId)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch) throw new Error("Batch not found.");

  const { docs, groundTruthByDoc } = await loadApprovedDocsWithGroundTruth(supabase, input.batchId);

  const comparisonGroupId = crypto.randomUUID();
  const runs: ComparisonRunOutput[] = [];
  const model = resolveAiModel();

  for (const profile of profiles) {
    const fields = (Array.isArray(profile.fields) ? profile.fields : []) as ProfileField[];
    if (fields.length === 0) continue;
    const { fields: fieldResults, overall, comparisons } = await extractAndCompare(
      model,
      profile.document_type ?? "",
      fields,
      docs,
      groundTruthByDoc,
    );
    const label = `${profile.name} · v${profile.version}`;
    runs.push(
      await persistComparisonRun(supabase, userId, {
        projectId: input.projectId,
        name: `${label} · ${batch.name}`,
        profileIds: [profile.id],
        batchIds: [input.batchId],
        profileLabels: [label],
        batchLabels: [batch.name],
        modelKey: `profile:${profile.id}`,
        modelLabel: label,
        comparisonGroupId,
        benchmarkMode: "schema",
        fieldResults,
        overall,
        documentsEvaluated: docs.length,
        comparisons,
      }),
    );
  }

  if (runs.length < 2) {
    throw new Error("At least two of the selected profile versions need fields to compare.");
  }

  return { comparisonGroupId, runs };
}
