import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell/AppShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LabelFactory" },
      { name: "description", content: "Manage your LabelFactory account and appearance." },
      { property: "og:title", content: "Settings — LabelFactory" },
      { property: "og:description", content: "Manage your LabelFactory account and appearance." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, isAdmin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <AppShell title="Settings">
      <div className="grid max-w-2xl gap-3">
        <section className="panel p-5">
          <h2 className="text-base font-semibold tracking-tight">Account</h2>
          <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="truncate">{user?.email}</dd>
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd>{isAdmin ? "Administrator" : "Member"}</dd>
          </dl>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 text-sm"
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </section>

        <section className="panel p-5">
          <h2 className="text-base font-semibold tracking-tight">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Currently using the {theme} theme.
          </p>
          <Button variant="outline" size="sm" className="mt-4 h-8 text-sm" onClick={toggleTheme}>
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </Button>
        </section>
      </div>
    </AppShell>
  );
}
