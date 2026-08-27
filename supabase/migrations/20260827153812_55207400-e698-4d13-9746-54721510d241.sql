CREATE TYPE public.finetune_job_status AS ENUM ('queued','running','complete','failed');

CREATE TABLE public.rlhf_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL DEFAULT 'jsonl',
  pair_count integer NOT NULL DEFAULT 0,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rlhf_exports TO authenticated;
GRANT ALL ON public.rlhf_exports TO service_role;
ALTER TABLE public.rlhf_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY rlhf_exports_all ON public.rlhf_exports FOR ALL TO authenticated
  USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));

CREATE TABLE public.finetune_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_model text NOT NULL,
  status public.finetune_job_status NOT NULL DEFAULT 'queued',
  profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  batch_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  date_from timestamptz,
  date_to timestamptz,
  pair_count integer NOT NULL DEFAULT 0,
  document_count integer NOT NULL DEFAULT 0,
  result_model text,
  error_message text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  callback_token text NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finetune_jobs TO authenticated;
GRANT ALL ON public.finetune_jobs TO service_role;
ALTER TABLE public.finetune_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY finetune_jobs_all ON public.finetune_jobs FOR ALL TO authenticated
  USING (public.can_access_project(project_id)) WITH CHECK (public.can_access_project(project_id));

CREATE TRIGGER finetune_jobs_set_updated_at BEFORE UPDATE ON public.finetune_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();