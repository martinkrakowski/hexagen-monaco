import type { SessionStatus } from "./session/planning-session";

/**
 * Shared presentation maps for a live session's status chip. Used by both the
 * right-pane live view (LiveSessionSection) and the left-pane "Sessions &
 * sources" list (SessionsSourcesList), so the two chips can't drift apart.
 */
export const STATUS_LABELS: Record<SessionStatus, string> = {
  proposing: "Proposing",
  critiquing: "Critiquing",
  revising: "Revising",
  "awaiting-human": "Awaiting you",
  converged: "Converged",
  finalizing: "Finalizing",
  done: "Done",
};

export const STATUS_CHIP_CLASSES: Partial<Record<SessionStatus, string>> = {
  "awaiting-human": "bg-warning/10 text-warning border-warning/20",
  converged: "bg-success/10 text-success border-success/20",
  done: "bg-muted text-muted-foreground border-border",
};

/** Fallback chip styling for the active (proposing/critiquing/…) statuses. */
export const DEFAULT_STATUS_CHIP_CLASS = "bg-info/10 text-info border-info/20";

export function statusChipClass(status: SessionStatus): string {
  return STATUS_CHIP_CLASSES[status] ?? DEFAULT_STATUS_CHIP_CLASS;
}
