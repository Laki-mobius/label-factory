import {
  Banknote,
  Building2,
  HeartPulse,
  Landmark,
  Scale,
  Factory,
  ShieldCheck,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const COVERS: Record<string, { icon: LucideIcon; caption: string }> = {
  finance: { icon: Banknote, caption: "Finance" },
  healthcare: { icon: HeartPulse, caption: "Healthcare" },
  legal: { icon: Scale, caption: "Legal" },
  manufacturing: { icon: Factory, caption: "Manufacturing" },
  insurance: { icon: ShieldCheck, caption: "Insurance" },
  logistics: { icon: Truck, caption: "Logistics" },
  general: { icon: Building2, caption: "General / Other" },
};

export function industryCover(workspaceType: string) {
  return COVERS[workspaceType] ?? { icon: Landmark, caption: "General / Other" };
}

/** Icon-based cover art. Uses design tokens only so it reskins with the theme. */
export function IndustryCover({
  workspaceType,
  className,
}: {
  workspaceType: string;
  className?: string;
}) {
  const { icon: Icon, caption } = industryCover(workspaceType);

  return (
    <div
      className={cn(
        "relative flex h-36 items-center justify-center overflow-hidden rounded-md border border-border bg-primary-soft",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-primary/5"
      />
      <Icon
        className="relative size-8 text-primary-soft-foreground"
        aria-label={`${caption} project cover`}
      />
      <span className="absolute bottom-1.5 right-2 text-2xs font-medium uppercase tracking-wide text-primary-soft-foreground/80">
        {caption}
      </span>
    </div>
  );
}
