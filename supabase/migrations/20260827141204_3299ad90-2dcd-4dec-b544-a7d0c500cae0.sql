CREATE OR REPLACE FUNCTION public.is_project_member(_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = _project_id AND m.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_project_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR public.is_admin() OR public.is_project_member(id));