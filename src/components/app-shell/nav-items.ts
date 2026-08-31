import {
  BarChart3,
  Boxes,
  Download,
  FlaskConical,
  GraduationCap,
  LayoutGrid,
  MessageSquareHeart,
  PenLine,
  Settings,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  to:
    | "/"
    | "/label-profile"
    | "/ingestion"
    | "/annotate"
    | "/synthetic-data"
    | "/benchmarking"
    | "/rlhf"
    | "/finetuning"
    | "/export"
    | "/admin"
    | "/settings";
  label: string;
  icon: LucideIcon;
  /** Page depends on an active project. */
  projectScoped: boolean;
  adminOnly?: boolean;
};

export const primaryNav: NavItem[] = [
  { to: "/", label: "Projects", icon: LayoutGrid, projectScoped: false },
  { to: "/label-profile", label: "Label Profile", icon: Boxes, projectScoped: true },
  { to: "/ingestion", label: "Ingestion", icon: UploadCloud, projectScoped: true },
  { to: "/annotate", label: "Annotate & Label", icon: PenLine, projectScoped: true },
  { to: "/synthetic-data", label: "Synthetic Data", icon: FlaskConical, projectScoped: true },
  { to: "/benchmarking", label: "Benchmarking & Evals", icon: BarChart3, projectScoped: true },
  { to: "/rlhf", label: "RLHF", icon: MessageSquareHeart, projectScoped: true },
  { to: "/finetuning", label: "Finetuning", icon: GraduationCap, projectScoped: true },
  { to: "/export", label: "Export", icon: Download, projectScoped: true },
  { to: "/admin", label: "Admin Console", icon: ShieldCheck, projectScoped: false, adminOnly: true },
];

export const pinnedNav: NavItem[] = [
  { to: "/settings", label: "Settings", icon: Settings, projectScoped: false },
];

export const allNav = [...primaryNav, ...pinnedNav];

export const WORKSPACE_TYPES = [
  { value: "finance", label: "Finance" },
  { value: "healthcare", label: "Healthcare" },
  { value: "legal", label: "Legal" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "insurance", label: "Insurance" },
  { value: "logistics", label: "Logistics" },
  { value: "real_estate", label: "Real Estate" },
  { value: "general", label: "General / Other" },
] as const;

export function workspaceTypeLabel(value: string) {
  return WORKSPACE_TYPES.find((type) => type.value === value)?.label ?? "General / Other";
}
