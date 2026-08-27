DROP POLICY IF EXISTS projects_select ON public.projects;
CREATE POLICY projects_select ON public.projects
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR public.is_admin()
  OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = projects.id AND m.user_id = auth.uid())
);
DELETE FROM public.projects WHERE name IN ('__m__','__curl_test__','__curl2__');