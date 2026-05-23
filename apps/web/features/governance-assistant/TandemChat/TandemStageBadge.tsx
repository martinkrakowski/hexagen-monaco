"use client";

export type TandemStage =
  | "stage1"
  | "transitioning"
  | "stage3"
  | "complete"
  | "error";

interface TandemStageBadgeProps {
  stage: TandemStage;
  localModelName?: string;
  cloudModelName?: string;
}

const STAGE_CONFIG: Record<
  TandemStage,
  { label: string; className: string; showSpinner?: boolean }
> = {
  stage1: {
    label: "Local Draft",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 animate-pulse",
  },
  transitioning: {
    label: "Sending to Cloud…",
    className: "bg-muted text-muted-foreground",
    showSpinner: true,
  },
  stage3: {
    label: "Cloud Refinement",
    className:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  complete: {
    label: "Complete",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  error: {
    label: "Error",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  },
};

export function TandemStageBadge({
  stage,
  localModelName,
  cloudModelName,
}: TandemStageBadgeProps) {
  const config = STAGE_CONFIG[stage];

  const label =
    stage === "stage1" && localModelName
      ? `Local Draft · ${localModelName}`
      : stage === "stage3" && cloudModelName
        ? `Cloud Refinement · ${cloudModelName}`
        : config.label;

  return (
    <span aria-live="polite" aria-atomic="true">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
      >
        {config.showSpinner && (
          <span
            className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {label}
      </span>
    </span>
  );
}
