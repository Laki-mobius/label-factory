-- Mark documents created from synthetic generation
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

CREATE TYPE public.synthetic_record_status AS ENUM ('pending', 'accepted', 'discarded');

CREATE TABLE public.synthetic_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  label_profile_id uuid NOT NULL REFERENCES public.label_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints_note text,
  status public.synthetic_record_status NOT NULL DEFAULT 'pending',
  accepted_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.synthetic_records TO authenticated;
GRANT ALL ON public.synthetic_records TO service_role;
ALTER TABLE public.synthetic_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_records_all ON public.synthetic_records FOR ALL TO authenticated
  USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));
CREATE TRIGGER trg_synthetic_records_updated BEFORE UPDATE ON public.synthetic_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_synthetic_records_project ON public.synthetic_records(project_id, created_at DESC);

CREATE TABLE public.benchmark_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  profile_ids uuid[] NOT NULL DEFAULT '{}',
  batch_ids uuid[] NOT NULL DEFAULT '{}',
  profile_labels text[] NOT NULL DEFAULT '{}',
  batch_labels text[] NOT NULL DEFAULT '{}',
  overall_score numeric NOT NULL DEFAULT 0,
  documents_evaluated integer NOT NULL DEFAULT 0,
  fields_evaluated integer NOT NULL DEFAULT 0,
  comparisons integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_runs TO authenticated;
GRANT ALL ON public.benchmark_runs TO service_role;
ALTER TABLE public.benchmark_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY benchmark_runs_all ON public.benchmark_runs FOR ALL TO authenticated
  USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));
CREATE INDEX idx_benchmark_runs_project ON public.benchmark_runs(project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.can_access_benchmark_run(_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.benchmark_runs r WHERE r.id = _run_id AND public.can_access_project(r.project_id));
$$;
REVOKE EXECUTE ON FUNCTION public.can_access_benchmark_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_benchmark_run(uuid) TO authenticated, service_role;

CREATE TABLE public.benchmark_field_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.benchmark_runs(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label text,
  total integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  near_matched integer NOT NULL DEFAULT 0,
  missed integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  match_rate numeric NOT NULL DEFAULT 0,
  precision_score numeric NOT NULL DEFAULT 0,
  recall_score numeric NOT NULL DEFAULT 0,
  failure_pattern text,
  mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_field_results TO authenticated;
GRANT ALL ON public.benchmark_field_results TO service_role;
ALTER TABLE public.benchmark_field_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY benchmark_field_results_all ON public.benchmark_field_results FOR ALL TO authenticated
  USING (public.can_access_benchmark_run(run_id)) WITH CHECK (public.can_access_benchmark_run(run_id));
CREATE INDEX idx_benchmark_field_results_run ON public.benchmark_field_results(run_id);