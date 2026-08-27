import { supabase } from "@/integrations/supabase/client";

export type MismatchSample = {
  document_id: string;
  filename: string;
  batch_id: string;
  suggested: string;
  final: string;
  kind: "missed" | "format" | "wrong" | "rejected";
};

export type FieldResult = {
  field_key: string;
  field_label: string;
  total: number;
  matched: number;
  near_matched: number;
  missed: number;
  rejected: number;
  match_rate: number;
  precision_score: number;
  recall_score: number;
  failure_pattern: string | null;
  mismatches: MismatchSample[];
};

export type BenchmarkComputation = {
  fields: FieldResult[];
  overall: number;
  documentsEvaluated: number;
  comparisons: number;
};

export function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function loose(value: string) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function asNumber(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: string) {
  const time = Date.parse(value.trim());
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

/** Exact, near (same content, different formatting) or wrong. */
export function compareValues(suggested: string, final: string): "match" | "near" | "wrong" {
  if (normalize(suggested) === normalize(final)) return "match";
  if (loose(suggested).length > 0 && loose(suggested) === loose(final)) return "near";
  const a = asDate(suggested);
  const b = asDate(final);
  if (a && b && a === b) return "near";
  const na = asNumber(suggested);
  const nb = asNumber(final);
  if (na !== null && nb !== null && Math.abs(na - nb) < 1e-9) return "near";
  return "wrong";
}

function describePattern(result: Omit<FieldResult, "failure_pattern">): string | null {
  const failures = result.total - result.matched;
  if (result.total === 0) return null;
  if (failures === 0) return null;
  if (result.missed / result.total >= 0.3) {
    return "AI frequently misses this field — it returns nothing and a human fills it in.";
  }
  if (result.near_matched >= Math.max(1, failures * 0.5)) {
    return "AI usually gets the right content but formats it differently (dates, casing, punctuation or units).";
  }
  if (result.rejected / result.total >= 0.2) {
    return "Reviewers often reject this field outright — the suggestion is usually not usable.";
  }
  return "AI values are often materially different from the approved value.";
}

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

  const buckets = new Map<string, FieldResult>();
  let comparisons = 0;

  for (const row of extractions ?? []) {
    const key = row.field_key;
    const suggested = row.suggested_value ?? "";
    const final = row.final_value ?? "";
    // Only rows a human actually settled count as ground truth.
    if (normalize(final).length === 0 && row.review_state !== "rejected") continue;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        field_key: key,
        field_label: row.field_label ?? key,
        total: 0,
        matched: 0,
        near_matched: 0,
        missed: 0,
        rejected: 0,
        match_rate: 0,
        precision_score: 0,
        recall_score: 0,
        failure_pattern: null,
        mismatches: [],
      };
      buckets.set(key, bucket);
    }

    bucket.total += 1;
    comparisons += 1;
    const doc = docById.get(row.document_id);
    const sample = {
      document_id: row.document_id,
      filename: doc?.filename ?? "Unknown document",
      batch_id: doc?.batch_id ?? "",
      suggested,
      final,
    };

    if (row.review_state === "rejected") {
      bucket.rejected += 1;
      if (bucket.mismatches.length < 25) bucket.mismatches.push({ ...sample, kind: "rejected" });
      continue;
    }
    if (normalize(suggested).length === 0) {
      bucket.missed += 1;
      if (bucket.mismatches.length < 25) bucket.mismatches.push({ ...sample, kind: "missed" });
      continue;
    }
    const verdict = compareValues(suggested, final);
    if (verdict === "match") {
      bucket.matched += 1;
    } else if (verdict === "near") {
      bucket.near_matched += 1;
      if (bucket.mismatches.length < 25) bucket.mismatches.push({ ...sample, kind: "format" });
    } else {
      if (bucket.mismatches.length < 25) bucket.mismatches.push({ ...sample, kind: "wrong" });
    }
  }

  const fields = [...buckets.values()].map((bucket) => {
    const suggestedCount = bucket.total - bucket.missed;
    const result: FieldResult = {
      ...bucket,
      match_rate: bucket.total === 0 ? 0 : bucket.matched / bucket.total,
      precision_score: suggestedCount === 0 ? 0 : bucket.matched / suggestedCount,
      recall_score: bucket.total === 0 ? 0 : bucket.matched / bucket.total,
      failure_pattern: null,
    };
    result.failure_pattern = describePattern(result);
    return result;
  });

  fields.sort((a, b) => a.match_rate - b.match_rate);

  const totalCompared = fields.reduce((sum, field) => sum + field.total, 0);
  const totalMatched = fields.reduce((sum, field) => sum + field.matched, 0);

  return {
    fields,
    overall: totalCompared === 0 ? 0 : totalMatched / totalCompared,
    documentsEvaluated: docs.length,
    comparisons,
  };
}

export function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
