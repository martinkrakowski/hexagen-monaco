"use client";

export type WorkspacePhase = "plan" | "architecture";

interface PhaseToggleProps {
  phase: WorkspacePhase;
  onPhaseChange: (phase: WorkspacePhase) => void;
}

/**
 * The Plan ↔ Architecture phase switcher. Labeled segmented buttons (the
 * accept-view tab pattern) rather than the icon-only ui `ViewToggle` — a
 * top-level phase needs readable names, and the two phases aren't an
 * eye/code-style icon pair.
 */
export function PhaseToggle({ phase, onPhaseChange }: PhaseToggleProps) {
  return (
    <div
      role="group"
      aria-label="Workspace phase"
      className="flex items-center gap-1 rounded-md border border-border p-0.5"
    >
      {(["plan", "architecture"] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPhaseChange(p)}
          aria-pressed={phase === p}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
            phase === p
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {p === "plan" ? "Plan" : "Architecture"}
        </button>
      ))}
    </div>
  );
}
