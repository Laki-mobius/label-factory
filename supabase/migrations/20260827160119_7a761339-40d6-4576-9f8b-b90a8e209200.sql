CREATE TABLE public.webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  auth_token text,
  auth_header text NOT NULL DEFAULT 'Authorization',
  custom_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  events text[] NOT NULL DEFAULT ARRAY['document.approved','export.completed']::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhooks TO authenticated;
GRANT ALL ON public.webhooks TO service_role;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhooks_all ON public.webhooks FOR ALL TO authenticated
  USING (public.can_access_project(project_id))
  WITH CHECK (public.can_access_project(project_id));

CREATE TRIGGER webhooks_set_updated_at BEFORE UPDATE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status integer,
  response_body text,
  error_message text,
  duration_ms integer,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_deliveries TO authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_all ON public.webhook_deliveries FOR ALL TO authenticated
  USING (public.can_access_project(project_id))
  WITH CHECK (public.can_access_project(project_id));

CREATE INDEX webhook_deliveries_project_created_idx ON public.webhook_deliveries (project_id, created_at DESC);