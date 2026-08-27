import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { primaryNav, pinnedNav, type NavItem } from "./nav-items";

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground/80",
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{
        className: "bg-sidebar-accent text-sidebar-accent-foreground",
        "aria-current": "page",
      }}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AppSidebar() {
  const { isAdmin } = useAuth();
  const items = primaryNav.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Layers className="size-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">LabelFactory</div>
          <div className="text-2xs text-muted-foreground">Document labeling</div>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        {pinnedNav.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </div>
    </aside>
  );
}
