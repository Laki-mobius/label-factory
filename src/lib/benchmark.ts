import { supabase } from "@/integrations/supabase/client";
import { classifyComparisons, percent, type FieldResult, type MismatchSample } from "@/lib/field-match";

export type { FieldResult, MismatchSample };
export { percent };

export type BenchmarkComputation = {
  fields: FieldResult[];
  overall: number;
  documentsEvaluated: number;
  comparisons: number;
};

/**
 * Retrospective single-configuration benchmark: compares each approved
 * document's already-stored AI suggestion against the human-approved final
 * value. Does not call any AI model — it's measuring the accuracy of
 * whatever prelabel run already happened. For comparing multiple candidate
 * models or label-profile versions against each other, see
 * `@/lib/benchmark-compare.functions` (re-runs extraction per candidate).
 */
export async function computeBenchmark(input: {
  projectId: string;
  batchIds: string[];
}): Promise<BenchmarkComputation> {
  if (input.batchIds.length === 0) {
    return { fields: [], overall: 0, documentsEvaluated: 0, comparisons: 0 };
  }

  const { data: documents, error: docError } = await supabase
    .from("documents")
    .select("id, filename, batch_id, status")
    .in("batch_id", input.batchIds)
    .eq("status", "approved");
  if (docError) throw docError;

  const docs = documents ?? [];
  if (docs.length === 0) {
    return { fields: [], overall: 0, documentsEvaluated: 0, comparisons: 0 };
  }

  const docById = new Map(docs.map((doc) => [doc.id, doc]));
  const { data: extractions, error: exError } = await supabase
    .from("extractions")
    .select("document_id, field_key, field_label, suggested_value, final_value, review_state")
    .in(
      "document_id",
      docs.map((doc) => doc.id),
    );
  if (exError) throw exError;

  const rows = (extractions ?? []).map((row) => {
    const doc = docById.get(row.document_id);
    return {
      ...row,
      filename: doc?.filename ?? "Unknown document",
      batch_id: doc?.batch_id ?? "",
    };
  });

  const { fields, overall, comparisons } = classifyComparisons(rows);

  return {
    fields,
    overall,
    documentsEvaluated: docs.length,
    comparisons,
  };
}
