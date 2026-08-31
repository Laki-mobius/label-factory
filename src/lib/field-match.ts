/**
 * Pure, framework-free field-value comparison helpers shared by the
 * client-side single-run benchmark (`@/lib/benchmark`) and the server-side
 * multi-model / multi-schema comparison runs (`@/lib/benchmark-compare.run.server`).
 * No Supabase import here on purpose — safe to use from both browser and
 * server code.
 */

export type MismatchSample = {
  document_id: string;
  filename: string;
  batch_id: string;
  suggested: string;
  final: string;
  kind: "missed" | "format" | "wrong" | "rejected";
  /** This document's own automatic PII-scan result for this field (see
   *  src/lib/pii-scan.server.ts) — independent of, and combined with, the
   *  label profile's manual per-field Sensitive flag wherever a benchmarking
   *  screen or third-party eval call decides whether to mask this sample. */
  pii_detected: boolean;
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

export function describePattern(result: Omit<FieldResult, "failure_pattern">): string | null {
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

/**
 * Buckets a flat list of (suggested, final, review_state) comparisons per
 * field_key into FieldResult rows. Shared by the live single-run benchmark
 * and the server-side re-extraction comparison runs.
 */
export function classifyComparisons(
  rows: Array<{
    field_key: string;
    field_label: string | null;
    suggested_value: string | null;
    final_value: string | null;
    review_state: string;
    document_id: string;
    filename: string;
    batch_id: string;
    /** Optional — absent callers (e.g. a row with no matching extraction)
     *  default to false, same as "no PII found". */
    pii_detected?: boolean | null;
  }>,
): { fields: FieldResult[]; overall: number; comparisons: number } {
  const buckets = new Map<string, FieldResult>();
  let comparisons = 0;

  for (const row of rows) {
    const key = row.field_key;
    const suggested = row.suggested_value ?? "";
    const final = row.final_value ?? "";
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
    const sample = {
      document_id: row.document_id,
      filename: row.filename,
      batch_id: row.batch_id,
      suggested,
      final,
      pii_detected: Boolean(row.pii_detected),
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
    comparisons,
  };
}

export function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
