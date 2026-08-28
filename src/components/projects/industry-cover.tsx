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

type PatternKind = "circles" | "dots" | "squares" | "waves" | "grid" | "chevrons" | "rings";

const COVERS: Record<
  string,
  {
    icon: LucideIcon;
    caption: string;
    from: string;
    to: string;
    pattern: PatternKind;
  }
> = {
  finance: {
    icon: Banknote,
    caption: "Finance",
    from: "oklch(0.52 0.2 152)",
    to: "oklch(0.38 0.12 185)",
    pattern: "rings",
  },
  healthcare: {
    icon: HeartPulse,
    caption: "Healthcare",
    from: "oklch(0.58 0.22 25)",
    to: "oklch(0.45 0.18 350)",
    pattern: "waves",
  },
  legal: {
    icon: Scale,
    caption: "Legal",
    from: "oklch(0.48 0.16 265)",
    to: "oklch(0.34 0.1 285)",
    pattern: "squares",
  },
  manufacturing: {
    icon: Factory,
    caption: "Manufacturing",
    from: "oklch(0.62 0.17 55)",
    to: "oklch(0.48 0.15 35)",
    pattern: "chevrons",
  },
  insurance: {
    icon: ShieldCheck,
    caption: "Insurance",
    from: "oklch(0.55 0.15 220)",
    to: "oklch(0.4 0.11 245)",
    pattern: "grid",
  },
  logistics: {
    icon: Truck,
    caption: "Logistics",
    from: "oklch(0.56 0.18 310)",
    to: "oklch(0.42 0.14 330)",
    pattern: "circles",
  },
  general: {
    icon: Building2,
    caption: "General / Other",
    from: "oklch(0.5 0.05 210)",
    to: "oklch(0.36 0.05 230)",
    pattern: "dots",
  },
};

const FALLBACK = {
  icon: Landmark,
  caption: "General / Other",
  from: "oklch(0.5 0.05 210)",
  to: "oklch(0.36 0.05 230)",
  pattern: "dots" as PatternKind,
};

export function industryCover(workspaceType: string) {
  return COVERS[workspaceType] ?? FALLBACK;
}

/** White line-art pattern, one per cover, drawn over the industry gradient. */
function Pattern({ kind }: { kind: PatternKind }) {
  const stroke = "rgba(255,255,255,0.55)";
  const common = {
    fill: "none",
    stroke,
    strokeWidth: 2,
  } as const;

  switch (kind) {
    case "rings":
      return (
        <g {...common}>
          <circle cx="120" cy="90" r="62" />
          <circle cx="150" cy="80" r="62" />
          <circle cx="180" cy="95" r="62" />
          <circle cx="150" cy="105" r="62" />
        </g>
      );
    case "circles":
      return (
        <g {...common}>
          <circle cx="70" cy="40" r="26" />
          <circle cx="250" cy="140" r="34" />
          <circle cx="290" cy="30" r="14" />
          <circle cx="40" cy="150" r="18" />
        </g>
      );
    case "squares":
      return (
        <g {...common}>
          <rect x="230" y="100" width="52" height="52" />
          <rect x="252" y="122" width="52" height="52" />
          <rect x="30" y="18" width="34" height="34" />
        </g>
      );
    case "waves":
      return (
        <g {...common}>
          <path d="M-10 130 Q 60 90 130 130 T 270 130 T 410 130" />
          <path d="M-10 150 Q 60 110 130 150 T 270 150 T 410 150" />
          <path d="M-10 170 Q 60 130 130 170 T 270 170 T 410 170" />
        </g>
      );
    case "grid":
      return (
        <g {...common}>
          {Array.from({ length: 5 }).map((_, row) =>
            Array.from({ length: 9 }).map((__, col) => (
              <circle
                key={`${row}-${col}`}
                cx={230 + col * 16}
                cy={14 + row * 16}
                r="4"
                fill={stroke}
                stroke="none"
              />
            )),
          )}
        </g>
      );
    case "chevrons":
      return (
        <g {...common}>
          <path d="M230 60 l40 40 l-40 40" />
          <path d="M258 60 l40 40 l-40 40" />
          <path d="M286 60 l40 40 l-40 40" />
          <path d="M314 60 l40 40 l-40 40" />
        </g>
      );
    case "dots":
    default:
      return (
        <g {...common}>
          {Array.from({ length: 4 }).map((_, row) =>
            Array.from({ length: 7 }).map((__, col) => (
              <circle
                key={`${row}-${col}`}
                cx={246 + col * 15}
                cy={16 + row * 15}
                r="4"
                fill={stroke}
                stroke="none"
              />
            )),
          )}
          <rect x="30" y="120" width="40" height="40" />
          <rect x="52" y="142" width="40" height="40" />
        </g>
      );
  }
}

/**
 * Industry cover art: solid per-industry gradient with white abstract
 * line-art shapes (inspired by bold brand covers). Decorative colors are
 * intentional art direction, not theme tokens.
 */
export function IndustryCover({
  workspaceType,
  className,
}: {
  workspaceType: string;
  className?: string;
}) {
  const { icon: Icon, caption, from, to, pattern } = industryCover(workspaceType);

  return (
    <div
      className={cn(
        "relative flex h-36 items-center overflow-hidden rounded-md",
        className,
      )}
      style={{ background: `linear-gradient(120deg, ${from}, ${to})` }}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 360 180"
        preserveAspectRatio="xMidYMid slice"
      >
        <Pattern kind={pattern} />
      </svg>
      <Icon
        className="relative ml-4 size-10 text-white/95 drop-shadow-sm"
        aria-label={`${caption} project cover`}
      />
      <span className="absolute bottom-1.5 right-2 text-2xs font-medium uppercase tracking-wide text-white/85">
        {caption}
      </span>
    </div>
  );
}
