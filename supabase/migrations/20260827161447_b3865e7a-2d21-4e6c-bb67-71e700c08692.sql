ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE POLICY "roles_admin_insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND user_id <> auth.uid());
CREATE POLICY "roles_admin_update" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.is_admin() AND user_id <> auth.uid())
  WITH CHECK (public.is_admin() AND user_id <> auth.uid());
CREATE POLICY "roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_admin() AND user_id <> auth.uid());

GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_storage_objects(_limit integer DEFAULT 200)
RETURNS TABLE (
  object_name text,
  project_id uuid,
  size_bytes bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;

  RETURN QUERY
  SELECT o.name::text,
         CASE WHEN split_part(o.name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
              THEN split_part(o.name, '/', 1)::uuid ELSE NULL END,
         COALESCE((o.metadata->>'size')::bigint, 0),
         o.created_at
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
  ORDER BY o.created_at DESC
  LIMIT GREATEST(_limit, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_storage_objects(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_storage_objects(integer) TO authenticated;