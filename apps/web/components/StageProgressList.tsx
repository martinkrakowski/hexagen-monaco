"use client";

import { useState } from "react";
import { Check, Terminal } from "lucide-react";
import { CopyButton } from "@hexagen/ui";
import type { NoSemanticState } from "@hexagen/ui";

export type StageProgressListProps = NoSemanticState<{
  stages: Array<{
    id: string;
    /** Accessible name for the stage. Not rendered as visible text -- see the row. */
    label: string;
    status: "complete" | "active" | "pending";
    duration?: string;
  }>;
  title?: string;
  logContent?: string;
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
    return (
      <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0">
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
  title,
  logContent,
}: StageProgressListProps) {
  const [isLogExpanded, setIsLogExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-4 w-full">
      {title && (
        <div className="text-sm font-semibold text-foreground">{title}</div>
      )}

      <div className="flex items-center gap-1.5 self-center">
        {stages.map((stage, index) => (
          // `label` is not rendered as visible text: the source this was
          // extracted from shows only the dot and duration here, and names the
          // *current* stage separately below the row. Rendering it would be a
          // behaviour change, not an extraction. It is used as the row's
          // accessible name instead -- otherwise this is a row of anonymous
          // dots to a screen reader, and the prop would be accepted-but-ignored.
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
            {index < stages.length - 1 && (
              <div className="w-4 h-px bg-border" />
            )}
          </div>
        ))}
      </div>

      {logContent && (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setIsLogExpanded(!isLogExpanded)}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1"
          >
            <Terminal className="h-3 w-3" />
            {isLogExpanded ? "Hide log" : "Show log"}
          </button>
          {isLogExpanded && (
            <div className="mt-2 w-full rounded-md border border-border/50 bg-muted/20 overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 bg-muted/30">
                <span className="text-xs text-muted-foreground/60 font-medium">
                  Log
                </span>
                <CopyButton
                  text={logContent}
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6 text-muted-foreground/60 hover:text-muted-foreground"
                  aria-label="Copy log"
                />
              </div>
              <pre className="p-3 text-xs font-mono text-muted-foreground overflow-x-auto">
                {logContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
