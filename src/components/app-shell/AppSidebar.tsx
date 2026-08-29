import { Link } from "@tanstack/react-router";

import logoAsset from "@/assets/logo.png.asset.json";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { primaryNav, pinnedNav, type NavItem } from "./nav-items";
import { useSidebarState } from "./sidebar-state";

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground/80",
        "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{
        className: "bg-sidebar-accent text-sidebar-accent-foreground",
        "aria-current": "page",
      }}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function AppSidebar() {
  const { isAdmin } = useAuth();
  const { collapsed } = useSidebarState();
  const items = primaryNav.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <img
          src={logoAsset.url}
          alt="LabelFactory"
          className="size-7 shrink-0 rounded-md object-contain"
        />
        {collapsed ? null : (
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">LabelFactory</div>
            <div className="text-2xs text-muted-foreground">Document labeling</div>
          </div>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        {pinnedNav.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </div>
    </aside>
  );
}
