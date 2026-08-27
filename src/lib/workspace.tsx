import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const PROJECT_KEY = "labelfactory.activeProjectId";
const BATCH_KEY = "labelfactory.activeBatchId";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  workspace_type: string;
  status: string;
  archived: boolean;
  created_at: string;
  owner_id: string;
};

type WorkspaceState = {
  /** Null until hydration finishes — never query with it while `ready` is false. */
  projectId: string | null;
  batchId: string | null;
  /** True once the persisted selection has been restored on the client. */
  ready: boolean;
  setProjectId: (id: string | null) => void;
  setBatchId: (id: string | null) => void;
  projects: ProjectSummary[];
  projectsLoading: boolean;
  activeProject: ProjectSummary | null;
  refetchProjects: () => void;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [batchId, setBatchIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProjectIdState(window.localStorage.getItem(PROJECT_KEY));
    setBatchIdState(window.localStorage.getItem(BATCH_KEY));
    setReady(true);
  }, []);

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    setBatchIdState(null);
    window.localStorage.removeItem(BATCH_KEY);
    if (id) window.localStorage.setItem(PROJECT_KEY, id);
    else window.localStorage.removeItem(PROJECT_KEY);
  }, []);

  const setBatchId = useCallback((id: string | null) => {
    setBatchIdState(id);
    if (id) window.localStorage.setItem(BATCH_KEY, id);
    else window.localStorage.removeItem(BATCH_KEY);
  }, []);

  const projectsQuery = useQuery({
    queryKey: ["projects", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<ProjectSummary[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, description, workspace_type, status, archived, created_at, owner_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  // Drop a stale selection that no longer resolves to a visible project.
  useEffect(() => {
    if (!ready || projectsQuery.isPending || !projectId) return;
    if (!projects.some((project) => project.id === projectId)) {
      setProjectId(null);
    }
  }, [ready, projectsQuery.isPending, projectId, projects, setProjectId]);

  const activeProject = projects.find((project) => project.id === projectId) ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        projectId,
        batchId,
        ready,
        setProjectId,
        setBatchId,
        projects,
        projectsLoading: projectsQuery.isPending,
        activeProject,
        refetchProjects: () => void projectsQuery.refetch(),
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return context;
}
