import { Bell, Menu, Moon, Search, Sun } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";
import { primaryNav, pinnedNav } from "./nav-items";

type TopBarProps = {
  title: string;
  showProjectSwitcher?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
};

export function TopBar({
  title,
  showProjectSwitcher = false,
  searchPlaceholder,
  searchValue,
  onSearchChange,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, signOut } = useAuth();
  const { projects, projectId, setProjectId } = useWorkspace();

  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-8 md:inline-flex"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
      >
        <Menu className="size-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild className="md:hidden">
          <Button variant="ghost" size="icon" className="size-8" aria-label="Open navigation">
            <Menu className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {[...primaryNav.filter((i) => !i.adminOnly || isAdmin), ...pinnedNav].map((item) => (
            <DropdownMenuItem key={item.to} asChild className="text-sm">
              <Link to={item.to}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>

      {showProjectSwitcher ? (
        <Select
          value={projectId ?? ""}
          onValueChange={(value) => setProjectId(value)}
          disabled={projects.length === 0}
        >
          <SelectTrigger
            className="h-8 w-52 text-sm"
            aria-label="Active project"
          >
            <SelectValue placeholder={projects.length ? "Select a project" : "No projects yet"} />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id} className="text-sm">
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        {onSearchChange ? (
          <div className="relative hidden sm:block">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchValue ?? ""}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder ?? "Search"}
              aria-label={searchPlaceholder ?? "Search"}
              className="h-8 w-56 pl-8 text-sm"
            />
          </div>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <Button variant="ghost" size="icon" className="size-8" aria-label="Notifications">
          <Bell className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="size-8 rounded-md bg-primary-soft p-0 text-2xs font-semibold text-primary-soft-foreground"
              aria-label="Account menu"
            >
              {initials}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              <div className="truncate text-sm font-medium text-foreground">{user?.email}</div>
              {isAdmin ? "Administrator" : "Member"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="text-sm">
              <Link to="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="text-sm" onSelect={() => void signOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
