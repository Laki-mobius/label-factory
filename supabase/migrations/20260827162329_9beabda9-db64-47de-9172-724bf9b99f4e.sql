ALTER TABLE public.model_connectors DROP COLUMN IF EXISTS api_key;
ALTER TABLE public.model_connectors ADD COLUMN IF NOT EXISTS api_key_cipher text;
ALTER TABLE public.model_connectors ADD COLUMN IF NOT EXISTS api_key_hint text;

REVOKE SELECT, INSERT, UPDATE ON public.model_connectors FROM authenticated;
GRANT SELECT (id, project_id, name, kind, provider, model_name, base_url, auth_type, custom_headers, is_default, api_key_hint, created_at, updated_at)
  ON public.model_connectors TO authenticated;
GRANT DELETE ON public.model_connectors TO authenticated;
GRANT ALL ON public.model_connectors TO service_role;