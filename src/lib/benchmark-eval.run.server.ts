import type { SupabaseClient } from "@supabase/supabase-js";

import { draftBenchmarkEvaluation, type EvalMismatchSample } from "./benchmark-eval.server";
import { resolveAiModel } from "./ai-provider.server";
import type { MismatchSample } from "./field-match";
import { maskForExport, sensitiveKeySet } from "./redact";

type FieldRow = {
  field_key: string;
  field_label: string | null;
  total: number;
  matched: number;
  near_matched: number;
  missed: number;
  rejected: number;
  match_rate: number;
  precision_score: number;
  recall_score: number;
  failure_pattern: string | null;
  mismatches: unknown;
};

function asMismatches(value: unknown): MismatchSample[] {
  return Array.isArray(value) ? (value as MismatchSample[]) : [];
}

function attentionLevel(issueRate: number): "high" | "medium" | "low" {
  if (issueRate >= 0.3) return "high";
  if (issueRate >= 0.1) return "medium";
  return "low";
}

function dominantCategory(mismatches: MismatchSample[]): string | null {
  const counts: Record<string, number> = {};
  for (const m of mismatches) counts[m.kind] = (counts[m.kind] ?? 0) + 1;
  let best: string | null = null;
  let bestCount = 0;
  for (const [kind, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Runs (and persists) an LLM-graded quality evaluation for one benchmark
 * run: deterministic field-attention / document-risk views are computed
 * here from the run's already-stored field results; faithfulness,
 * completeness, consistency and hallucination_risk come from an AI call.
 */
export async function runBenchmarkEvaluation(
  supabase: SupabaseClient<any>,
  userId: string,
  runId: string,
) {
  const { data: run, error: runErr } = await supabase
    .from("benchmark_runs")
    .select("id, name, model_label, documents_evaluated, profile_ids")
    .eq("id", runId)
    .maybeSingle();
  if (runErr) throw new Error(runErr.message);
  if (!run) throw new Error("Benchmark run not found.");

  // This run's field values are about to be sent to a third-party LLM for
  // eval commentary (draftBenchmarkEvaluation, below) — a genuine exfiltration
  // path, unlike everything else in this file which only ever renders to the
  // reviewer's own screen. Mask any field the run's label profile(s) marked
  // Sensitive before it leaves the app; there is no "reveal" for this one.
  const profileIds = Array.isArray(run.profile_ids) ? (run.profile_ids as string[]) : [];
  const sensitiveKeys = new Set<string>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("label_profiles")
      .select("fields")
      .in("id", profileIds);
    for (const profile of profiles ?? []) {
      for (const key of sensitiveKeySet(profile.fields)) sensitiveKeys.add(key);
    }
  }

  const { data: fieldRows, error: fieldErr } = await supabase
    .from("benchmark_field_results")
    .select(
      "field_key, field_label, total, matched, near_matched, missed, rejected, match_rate, precision_score, recall_score, failure_pattern, mismatches",
    )
    .eq("run_id", runId);
  if (fieldErr) throw new Error(fieldErr.message);
  const fields = (fieldRows ?? []) as FieldRow[];
  if (fields.length === 0) {
    throw new Error("This run has no field results yet — nothing to evaluate.");
  }

  const fieldAttention = fields
    .map((field) => {
      const issues = field.total - field.matched;
      const issueRate = field.total === 0 ? 0 : issues / field.total;
      const mismatches = asMismatches(field.mismatches);
      return {
        field_key: field.field_key,
        field_label: field.field_label ?? field.field_key,
        issue_count: issues,
        total: field.total,
        issue_rate: issueRate,
        main_category: dominantCategory(mismatches),
        attention_level: attentionLevel(issueRate),
        suggested_action:
          issues === 0
            ? null
            : `Review "${field.field_label ?? field.field_key}" — ${issues} of ${field.total} compared documents needed a correction (${dominantCategory(mismatches) ?? "mixed"} issues).`,
        examples: mismatches.slice(0, 3).map((m) => ({
          document_name: m.filename,
          category: m.kind,
          suggested: m.suggested,
          final: m.final,
        })),
      };
    })
    .filter((field) => field.issue_count > 0)
    .sort((a, b) => b.issue_rate - a.issue_rate);

  const perDocIssues = new Map<string, { filename: string; issues: number }>();
  for (const field of fields) {
    for (const mismatch of asMismatches(field.mismatches)) {
      const entry = perDocIssues.get(mismatch.document_id) ?? { filename: mismatch.filename, issues: 0 };
      entry.issues += 1;
      perDocIssues.set(mismatch.document_id, entry);
    }
  }
  const riskDocuments = [...perDocIssues.entries()]
    .map(([documentId, entry]) => ({
      document_id: documentId,
      document_name: entry.filename,
      issues: entry.issues,
      risk_level: entry.issues >= 4 ? "high" : entry.issues >= 2 ? "medium" : "low",
    }))
    .sort((a, b) => b.issues - a.issues);
  const buckets = {
    high: riskDocuments.filter((doc) => doc.risk_level === "high").length,
    medium: riskDocuments.filter((doc) => doc.risk_level === "medium").length,
    low: riskDocuments.filter((doc) => doc.risk_level === "low").length,
    clear: Math.max(0, (run.documents_evaluated ?? 0) - riskDocuments.length),
  };

  const sampleMismatches: EvalMismatchSample[] = fields.flatMap((field) => {
    const isSensitive = sensitiveKeys.has(field.field_key);
    return asMismatches(field.mismatches)
      .slice(0, 2)
      .map((m) => ({
        field: field.field_label ?? field.field_key,
        suggested: isSensitive ? maskForExport(m.suggested) : m.suggested,
        final: isSensitive ? maskForExport(m.final) : m.final,
        kind: m.kind,
      }));
  });

  const draft = await draftBenchmarkEvaluation({
    model: resolveAiModel(),
    runLabel: run.model_label ?? run.name,
    fields: fields.map((field) => ({
      label: field.field_label ?? field.field_key,
      match_rate: field.match_rate,
      precision: field.precision_score,
      recall: field.recall_score,
      total: field.total,
      missed: field.missed,
      rejected: field.rejected,
      near_matched: field.near_matched,
      failure_pattern: field.failure_pattern,
    })),
    sampleMismatches: sampleMismatches.slice(0, 20),
  });

  const { data: saved, error: saveError } = await supabase
    .from("benchmark_evaluations")
    .insert({
      run_id: runId,
      faithfulness: draft.faithfulness,
      completeness: draft.completeness,
      consistency: draft.consistency,
      hallucination_risk: draft.hallucination_risk,
      field_attention: fieldAttention as unknown as never,
      document_risk: { buckets, documents: riskDocuments.slice(0, 20) } as unknown as never,
      recommendations: draft.recommendations,
      ai_summary: draft.summary,
      created_by: userId,
    })
    .select("*")
    .single();
  if (saveError) throw new Error(saveError.message);

  return saved;
}
