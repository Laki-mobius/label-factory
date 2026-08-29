import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS: Record<"feedback" | "preference", string[]> = {
  feedback: [
    "Preparing context",
    "Reading corrected fields",
    "Comparing AI vs ground truth",
    "Assigning reason",
  ],
  preference: [
    "Preparing comparison",
    "Reading document context",
    "Comparing candidates",
    "Choosing preference",
  ],
};

export type RewardAiStatus = "idle" | "running" | "drafted" | "failed" | "saved";

const STATUS_STYLE: Record<RewardAiStatus, string> = {
  idle: "bg-muted text-muted-foreground",
  running: "bg-primary-soft text-primary-soft-foreground",
  drafted: "bg-primary-soft text-primary-soft-foreground",
  saved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

const STATUS_LABEL: Record<RewardAiStatus, string> = {
  idle: "Idle",
  running: "Running",
  drafted: "Draft ready",
  saved: "Saved",
  failed: "Failed",
};

type RewardAiPanelProps = {
  mode: "feedback" | "preference";
  pendingCount: number;
  status: RewardAiStatus;
  draftedCount?: number;
  errorMessage?: string | null;
  onRun: () => void;
  onClear: () => void;
};

/**
 * "Reward AI" assist widget: runs an AI draft pass over the fields still
 * needing attention, shows a lightweight progress timeline while the
 * (synchronous) server call is in flight, and reports the outcome. Drafts
 * are never written to the database here — the caller merges them into its
 * own editable state and the reviewer saves explicitly.
 */
export function RewardAiPanel({
  mode,
  pendingCount,
  status,
  draftedCount,
  errorMessage,
  onRun,
  onClear,
}: RewardAiPanelProps) {
  const steps = STEPS[mode];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (status !== "running") {
      setActiveStep(0);
      return;
    }
    setActiveStep(0);
    const interval = setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, steps.length - 1));
    }, 650);
    return () => clearInterval(interval);
  }, [status, steps.length]);

  return (
    <div className="panel space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          Reward AI
        </div>
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-2xs font-medium",
            STATUS_STYLE[status],
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {mode === "feedback"
          ? "Drafts a reason code and short explanation for each corrected field."
          : "Drafts a Model B candidate and a suggested preference for each field."}
      </p>

      {status === "running" ? (
        <ol className="space-y-1.5">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-2 text-xs">
              {index < activeStep ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              ) : index === activeStep ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border border-border" aria-hidden="true" />
              )}
              <span className={index <= activeStep ? "text-foreground" : "text-muted-foreground"}>
                {step}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {status === "failed" && errorMessage ? (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {errorMessage}
        </p>
      ) : null}

      {status === "drafted" && typeof draftedCount === "number" ? (
        <p className="text-xs text-muted-foreground">
          Drafted {draftedCount} field{draftedCount === 1 ? "" : "s"}. Review and edit below, then save.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 flex-1 text-xs"
          disabled={status === "running" || pendingCount === 0}
          onClick={onRun}
        >
          {status === "running" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          Run on {pendingCount} field{pendingCount === 1 ? "" : "s"}
        </Button>
        {status === "drafted" ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClear}>
            Clear draft
          </Button>
        ) : null}
      </div>
    </div>
  );
}
