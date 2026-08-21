import { Check } from "lucide-react";
import type { NoSemanticState } from "@hexagen/ui";

/**
 * Horizontal stage-progress row: one dot per stage, a duration beside completed
 * stages, and a connector between them.
 *
 * Extracted verbatim from ThinkingBlock's step row (BF-1.3) so the brownfield
 * scan-progress screen can reuse it -- a new feature slice cannot import from
 * features/manifest-generation, since cross-slice imports are fatal.
 *
 * Scope is deliberately the step row and NOTHING else. ThinkingBlock's verbose
 * log panel is a separate concern with its own per-line parsing, icons,
 * colouring and auto-scroll; it stays where it is. An earlier revision of this
 * component accepted a `logContent` string and rendered it as flat <pre> text,
 * which silently replaced that panel and dropped every one of those behaviours.
 *
 * No `use client` directive: this renders from props with no state, effects or
 * event handlers, so it works as a Server Component and its client-side hosts
 * still carry it into their own client bundle.
 */
export type StageProgressListProps = NoSemanticState<{
  stages: Array<{
    id: string;
    /** Accessible name for the stage. Not rendered as visible text -- see the row. */
    label: string;
    status: "complete" | "active" | "pending";
    /** Preformatted, e.g. "1.9s". Shown only for completed stages. */
    duration?: string;
  }>;
  /** Extra classes for the row container, e.g. layout hints from the host. */
  className?: string;
}>;

function StatusIndicator({
  status,
}: {
  status: StageProgressListProps["stages"][number]["status"];
}) {
  if (status === "complete") {
    return (
      <div className="w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Check className="w-3 h-3 text-primary" />
      </div>
    );
  }
  if (status === "active") {
    // `step-dot-active` is the dotPulse animation from globals.css, with a
    // prefers-reduced-motion override. Dropping it removes the only cue that
    // the active stage is actually running.
    return (
      <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0 step-dot-active">
        <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
      </div>
    );
  }
  return (
    <div className="w-4 h-4 rounded-full border border-muted-foreground/20 shrink-0" />
  );
}

export function StageProgressList({
  stages,
  className,
}: StageProgressListProps) {
  return (
    <div
      className={["flex items-center gap-1.5", className]
        .filter(Boolean)
        .join(" ")}
    >
      {stages.map((stage, index) => (
        // `label` is not rendered as visible text: the source this was extracted
        // from shows only the dot and duration here, and names the *current*
        // stage separately below the row. Rendering it would be a behaviour
        // change, not an extraction. It is the row's accessible name instead --
        // otherwise this is a row of anonymous dots to a screen reader, and the
        // prop would be accepted-but-ignored.
        <div
          key={stage.id}
          data-stage-status={stage.status}
          aria-label={`${stage.label}: ${stage.status}`}
          className="flex items-center gap-1.5"
        >
          <StatusIndicator status={stage.status} />
          {stage.status === "complete" && stage.duration && (
            <span className="text-xs text-muted-foreground/60 tabular-nums">
              {stage.duration}
            </span>
          )}
          {index < stages.length - 1 && <div className="w-4 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}
