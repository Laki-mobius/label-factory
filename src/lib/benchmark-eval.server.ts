import { generateText } from "ai";
import { resolveAiModel } from "@/lib/ai-provider.server";

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function clamp01(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

const EVAL_SYSTEM = `You are a rigorous ML evaluator auditing an AI document-extraction run against human-approved ground truth.
You are given per-field accuracy statistics and a sample of mismatches (the AI-suggested value vs. the human-approved final value).
Score four qualities on a 0.0-1.0 scale, using the statistics as evidence (do not just guess):
- faithfulness: how well AI values reflect the actual approved content rather than being fabricated. Lower when the rejected/wrong rate is high.
- completeness: how often the AI returns a usable value at all. Lower when the missed rate is high.
- consistency: how uniform accuracy is across fields. Lower when some fields are near-perfect and others are very poor (high variance).
- hallucination_risk: how often the AI appears to confidently invent a plausible-but-wrong value rather than admitting it doesn't know. Higher = worse. Estimate from the "wrong" mismatches (not "missed" ones, which are honest gaps, not hallucinations).
Then write:
- summary: one short paragraph (2-3 sentences) on overall extraction quality and the single biggest risk.
- recommendations: 2-4 short, concrete, actionable strings (schema, prompt, or field-definition fixes — not generic advice).
Return ONLY JSON: {"faithfulness":0.0,"completeness":0.0,"consistency":0.0,"hallucination_risk":0.0,"summary":"...","recommendations":["...","..."]}
No markdown fences, no extra keys.`;

export type EvalFieldStat = {
  label: string;
  match_rate: number;
  precision: number;
  recall: number;
  total: number;
  missed: number;
  rejected: number;
  near_matched: number;
  failure_pattern: string | null;
};

export type EvalMismatchSample = { field: string; suggested: string; final: string; kind: string };

export type EvalDraft = {
  faithfulness: number;
  completeness: number;
  consistency: number;
  hallucination_risk: number;
  summary: string;
  recommendations: string[];
};

export async function draftBenchmarkEvaluation(input: {
  model: ReturnType<typeof resolveAiModel>;
  runLabel: string;
  fields: EvalFieldStat[];
  sampleMismatches: EvalMismatchSample[];
}): Promise<EvalDraft> {
  const fieldLines = input.fields
    .map(
      (f) =>
        `- ${f.label}: match ${Math.round(f.match_rate * 100)}%, precision ${Math.round(f.precision * 100)}%, recall ${Math.round(f.recall * 100)}%, ${f.total} compared, ${f.missed} missed, ${f.rejected} rejected, ${f.near_matched} near-matches. ${f.failure_pattern ?? ""}`,
    )
    .join("\n");

  const mismatchLines = input.sampleMismatches
    .map((m) => `- [${m.field}/${m.kind}] suggested "${m.suggested}" vs approved "${m.final}"`)
    .join("\n");

  const result = await generateText({
    model: input.model,
    system: EVAL_SYSTEM,
    prompt: `Run: "${input.runLabel}"

Per-field statistics:
${fieldLines || "(no fields)"}

Sample mismatches:
${mismatchLines || "(no mismatches sampled — accuracy may be high)"}`,
  });

  const parsed = (extractJson(result.text) as Record<string, unknown> | null) ?? {};
  const recommendations = Array.isArray(parsed["recommendations"])
    ? (parsed["recommendations"] as unknown[]).map((item) => String(item)).slice(0, 6)
    : [];

  return {
    faithfulness: clamp01(parsed["faithfulness"], 0.5),
    completeness: clamp01(parsed["completeness"], 0.5),
    consistency: clamp01(parsed["consistency"], 0.5),
    hallucination_risk: clamp01(parsed["hallucination_risk"], 0.5),
    summary: String(parsed["summary"] ?? "").slice(0, 800) || "No summary was returned.",
    recommendations,
  };
}
