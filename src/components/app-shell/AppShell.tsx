import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

type AppShellProps = {
  title: string;
  showProjectSwitcher?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function AppShell({ title, children, actions, ...topBarProps }: AppShellProps) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!loading && !session) {
      void navigate({ to: "/auth", search: { next: pathname }, replace: true });
    }
  }, [loading, session, navigate, pathname]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <SidebarStateProvider>
      <div className="flex min-h-screen bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar title={title} {...topBarProps} />
          <main className="flex-1 p-5">
            {actions ? <div className="mb-4 flex justify-end gap-2">{actions}</div> : null}
            {children}
          </main>
        </div>
      </div>
    </SidebarStateProvider>
  );
}
