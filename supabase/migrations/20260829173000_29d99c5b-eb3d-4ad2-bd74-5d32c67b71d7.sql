-- RLHF workbench port: correction reason capture + model preference decisions.

-- Reason taken when a reviewer corrects an extraction (mirrors the old
-- dl-frontend reason taxonomy).
CREATE TYPE public.extraction_reason_code AS ENUM (
  'wrong_value',
  'partial_extraction',
  'wrong_entity_mapping',
  'wrong_evidence_mapping',
  'format_issue',
  'other'
);

ALTER TABLE public.extractions
  ADD COLUMN reason_code public.extraction_reason_code,
  ADD COLUMN reason_notes TEXT;

-- Model A / Model B preference decision (DPO signal), one row per document
-- field. Model A is always the extraction already on file; Model B is an
-- alternate candidate value (drafted by Reward AI or entered by hand).
CREATE TYPE public.preference_decision AS ENUM ('prefer_a', 'prefer_b', 'both', 'neither');

CREATE TABLE public.rlhf_preference_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT,
  model_a_value TEXT,
  model_b_value TEXT,
  decision public.preference_decision,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rlhf_preference_decisions TO authenticated;
GRANT ALL ON public.rlhf_preference_decisions TO service_role;
ALTER TABLE public.rlhf_preference_decisions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_rlhf_preference_decisions_updated
  BEFORE UPDATE ON public.rlhf_preference_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "rlhf_preference_decisions_all" ON public.rlhf_preference_decisions
  FOR ALL TO authenticated
  USING (public.can_access_document(document_id))
  WITH CHECK (public.can_access_document(document_id));
