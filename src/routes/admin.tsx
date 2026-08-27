import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell/AppShell";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — LabelFactory" },
      { name: "description", content: "Manage users, roles and platform-wide project access." },
      { property: "og:title", content: "Admin Console — LabelFactory" },
      {
        property: "og:description",
        content: "Manage users, roles and platform-wide project access.",
      },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin } = useAuth();

  return (
    <AppShell title="Admin Console">
      <div className="panel p-6">
        {isAdmin ? (
          <>
            <h2 className="text-base font-semibold tracking-tight">Admin Console</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Manage users and roles, review every project on the platform, and curate the shared
              field library.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">This section is coming next.</p>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold tracking-tight">Administrator access required</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Your account does not have the admin role. Ask an administrator for access.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
