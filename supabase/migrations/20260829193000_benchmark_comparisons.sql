-- Benchmarking v2: multi-model / multi-schema comparison runs + LLM-graded evaluations.

-- A single benchmark_runs row already represents one configuration's result.
-- To support comparing several models (or several label-profile versions)
-- side by side, a set of runs created together share a comparison_group_id,
-- and each carries which model (or schema/profile version) it represents.
ALTER TABLE public.benchmark_runs
  ADD COLUMN model_key TEXT,
  ADD COLUMN model_label TEXT,
  ADD COLUMN comparison_group_id UUID,
  ADD COLUMN benchmark_mode TEXT NOT NULL DEFAULT 'model';

ALTER TABLE public.benchmark_runs
  ADD CONSTRAINT benchmark_runs_benchmark_mode_check
  CHECK (benchmark_mode IN ('model', 'schema'));

CREATE INDEX idx_benchmark_runs_comparison_group ON public.benchmark_runs(comparison_group_id);

-- LLM-graded quality evaluation for one benchmark run (the "Evaluations" tab).
-- Deterministic stats (accuracy/precision/recall/failure patterns) already
-- live on benchmark_runs/benchmark_field_results; this table holds only the
-- AI-judged layer plus the derived attention/risk views built on top of it.
CREATE TABLE public.benchmark_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,
  faithfulness NUMERIC(5,4),
  completeness NUMERIC(5,4),
  consistency NUMERIC(5,4),
  hallucination_risk NUMERIC(5,4),
  field_attention JSONB NOT NULL DEFAULT '[]'::jsonb,
  document_risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations TEXT[] NOT NULL DEFAULT '{}',
  ai_summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_evaluations TO authenticated;
GRANT ALL ON public.benchmark_evaluations TO service_role;
ALTER TABLE public.benchmark_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmark_evaluations_all" ON public.benchmark_evaluations
  FOR ALL TO authenticated
  USING (public.can_access_benchmark_run(run_id))
  WITH CHECK (public.can_access_benchmark_run(run_id));

CREATE INDEX idx_benchmark_evaluations_run ON public.benchmark_evaluations(run_id);
