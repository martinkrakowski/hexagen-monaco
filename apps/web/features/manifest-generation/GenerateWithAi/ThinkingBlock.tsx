"use client";

import { Fragment, useRef, useEffect, useState } from "react";
import { Loader2, Check, Terminal, AlertCircle, Clock } from "lucide-react";
import { CopyButton } from "@hexagen/ui";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import { StageProgressList } from "@/StageProgressList";

const STAGE_ORDER: StagedPhase[] = [
  "stage-0",
  "stage-1",
  "stage-2",
  "stage-3",
  "stage-4",
  "stage-5",
  "stage-6",
];

const STAGE_LABELS: Record<StagedPhase, string> = {
  idle: "Preparing",
  "stage-0": "Normalizing Prompt",
  "stage-1": "Extracting Domain",
  "stage-2": "Classifying Contexts",
  "stage-3": "Mapping Ports",
  "stage-4": "Assigning Adapters",
  "stage-5": "Assembling Manifest",
  "stage-6": "Validating",
  complete: "Complete",
  failed: "Failed",
};

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

interface ThinkingBlockProps {
  phase: StagedPhase;
  stepDetail: string;
  stageProgress?: Record<number, StageProgress>;
  /**
   * Override labels for specific stages.
   * Used by the structured config pipeline to show accurate labels
   * for Stages 0-2 (which run as deterministic parsers, not LLM calls).
   */
  stageLabels?: Partial<Record<StagedPhase, string>>;
  verboseLog?: string[];
}

interface LogEntryParsed {
  text: string;
  icon?: "success" | "error" | "warning" | "throttle" | "retry" | "context";
  color: string;
}

function parseLogEntry(entry: string): LogEntryParsed {
  let text = entry;
  let icon: LogEntryParsed["icon"];
  let color = "text-muted-foreground";

  const isHeader = /^Stage \d/.test(entry);
  if (isHeader) {
    return { text, color: "text-foreground font-semibold mt-2 first:mt-0" };
  }

  const lowerEntry = entry.toLowerCase();

  // Strip legacy emojis and detect icon type based on content keywords
  if (
    entry.includes("✓") ||
    lowerEntry.includes("identified") ||
    lowerEntry.includes("extracted") ||
    lowerEntry.includes("validation passed") ||
    lowerEntry.includes("assigned across")
  ) {
    text = entry.replace(/✓/g, "").trim();
    icon = "success";
    color = "text-emerald-600 dark:text-emerald-400";
  } else if (
    entry.includes("✗") ||
    (lowerEntry.includes("all") && lowerEntry.includes("attempts exhausted")) ||
    lowerEntry.includes("no port definitions") ||
    (lowerEntry.includes("error") && lowerEntry.includes("found"))
  ) {
    text = entry.replace(/✗/g, "").trim();
    icon = "error";
    color = "text-destructive";
  } else if (
    entry.includes("⚠") ||
    lowerEntry.includes("tps-limited") ||
    lowerEntry.includes("rate limited") ||
    lowerEntry.includes("rate limit encountered")
  ) {
    text = entry.replace(/⚠/g, "").trim();
    icon = "warning";
    color = "text-destructive";
  } else if (
    entry.includes("⏳") ||
    lowerEntry.includes("endpoint throttled") ||
    lowerEntry.includes("waiting")
  ) {
    text = entry.replace(/⏳/g, "").trim();
    icon = "throttle";
    color = "text-amber-600 dark:text-amber-400";
  } else if (
    entry.includes("↻") ||
    lowerEntry.includes("retrying") ||
    lowerEntry.includes("retry")
  ) {
    text = entry.replace(/↻/g, "").trim();
    icon = "retry";
    color = "text-amber-600 dark:text-amber-400";
  } else if (entry.includes("⏱") || lowerEntry.includes("timed out")) {
    text = entry.replace(/⏱/g, "").trim();
    icon = "retry";
    color = "text-amber-600 dark:text-amber-400";
  } else if (entry.startsWith("→")) {
    text = entry.substring(1).trim();
    icon = "context";
    color = "text-foreground/80";
  }

  return { text, icon, color };
}

function LogEntryIcon({ type }: { type: LogEntryParsed["icon"] }) {
  if (!type) return null;
  switch (type) {
    case "success":
      return (
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
      );
    case "error":
      return <AlertCircle className="h-3 w-3 text-destructive shrink-0" />;
    case "warning":
      return <AlertCircle className="h-3 w-3 text-destructive shrink-0" />;
    case "throttle":
      return (
        <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
      );
    case "retry":
      return (
        <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
      );
    case "context":
      return null;
    default:
      return null;
  }
}

function VerboseLogPanel({
  entries,
  stageProgress,
  className,
}: {
  entries: string[];
  stageProgress?: Record<number, StageProgress>;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      className={[
        "w-full rounded-md border border-border/50 bg-muted/20 overflow-hidden flex flex-col",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 bg-muted/30 shrink-0">
        <Terminal className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-xs text-muted-foreground/60 font-medium">
          Generation log
        </span>
        <CopyButton
          text={entries.join("\n")}
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6 text-muted-foreground/60 hover:text-muted-foreground"
          aria-label="Copy log"
        />
      </div>
      <div
        ref={scrollRef}
        className="overflow-y-auto p-3 space-y-0.5 flex-1 min-h-0"
      >
        {entries.map((entry, i) => {
          const parsed = parseLogEntry(entry);
          const headerMatch = entry.match(/^Stage (\d+)/);
          const isHeader = headerMatch !== null;
          const stageNum = headerMatch ? Number(headerMatch[1]) : undefined;
          return (
            <Fragment key={i}>
              <div
                className={[
                  "font-mono text-xs leading-relaxed",
                  isHeader ? "mt-2 first:mt-0" : "",
                  parsed.color,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {parsed.icon ? (
                  <div className="flex items-start gap-1.5">
                    <LogEntryIcon type={parsed.icon} />
                    <span className="whitespace-pre">{parsed.text}</span>
                  </div>
                ) : (
                  <span
                    className={`whitespace-pre ${isHeader ? "font-semibold" : ""}`}
                  >
                    {parsed.text}
                  </span>
                )}
              </div>
              {stageNum !== undefined && (
                <StageTelemetryLine
                  telemetry={stageProgress?.[stageNum]?.telemetry}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// StepIndicator moved to apps/web/components/StageProgressList.tsx (BF-1.3) as
// StatusIndicator, verbatim -- including the `step-dot-active` pulse on the
// active dot.

function DetailLine({ text }: { text: string }) {
  const prevText = usePrevious(text);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (prevText === undefined || prevText === text) return;
    setIsTransitioning(true);
    const t = setTimeout(() => setIsTransitioning(false), 400);
    return () => clearTimeout(t);
  }, [text, prevText]);

  return (
    <div className="relative overflow-hidden h-5">
      {isTransitioning && prevText !== undefined && (
        <div className="detail-rolodex-exit absolute inset-x-0 top-0">
          <span className="text-sm text-foreground/70">{prevText}</span>
        </div>
      )}
      <div className={isTransitioning ? "detail-rolodex-enter" : ""}>
        <span className="text-sm text-foreground/70">{text}</span>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/**
 * Live, per-stage elapsed-time counter. Owns its own interval + state so only
 * this leaf re-renders on each tick (the surrounding log is left untouched).
 * Resets whenever `resetKey` (the active phase) changes, so it reads as the
 * time spent in the *current* stage; completed stages keep their final
 * duration in the step row, now rendered by `StageProgressList`.
 */
function LiveTimer({ resetKey }: { resetKey: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(id);
  }, [resetKey]);
  return (
    <span className="text-sm font-medium text-foreground/70 tabular-nums">
      {(elapsedMs / 1000).toFixed(1)}s
    </span>
  );
}

/**
 * Compact per-stage telemetry line for the generation log: duration, token
 * usage (in/out), retry count, and cache status. The structured StageTelemetry
 * already streams to the client on `stage-telemetry`; previously only
 * `durationMs` was surfaced (in the step row), so the rest is shown here to
 * raise the log's granularity without any extra network payload.
 */
function StageTelemetryLine({
  telemetry,
}: {
  telemetry?: StageProgress["telemetry"];
}) {
  if (!telemetry) return null;
  const parts: string[] = [formatDuration(telemetry.durationMs)];
  if (
    telemetry.usedLLM &&
    (telemetry.inputTokensEstimate > 0 || telemetry.outputTokensActual > 0)
  ) {
    parts.push(
      `${telemetry.inputTokensEstimate.toLocaleString()} in / ${telemetry.outputTokensActual.toLocaleString()} out tok`,
    );
  }
  if (telemetry.retryCount > 0) {
    parts.push(
      `${telemetry.retryCount} ${telemetry.retryCount === 1 ? "retry" : "retries"}`,
    );
  }
  if (telemetry.servedFromCache) parts.push("cached");
  return (
    <div className="font-mono text-xs text-muted-foreground/70 tabular-nums pl-0.5 pb-1">
      {parts.join("  ·  ")}
    </div>
  );
}

export function ThinkingBlock({
  phase,
  stepDetail,
  stageProgress,
  stageLabels,
  verboseLog,
}: ThinkingBlockProps) {
  if (phase === "idle" || phase === "failed") return null;

  if (phase === "complete") {
    return (
      <div className="flex flex-col gap-2 py-3 w-full h-full">
        <div className="flex items-center gap-2 shrink-0">
          <Check className="h-4 w-4 text-primary" />
          <span className="text-base font-semibold text-foreground">
            Generation Complete
          </span>
        </div>
        {verboseLog && verboseLog.length > 0 && (
          <VerboseLogPanel
            entries={verboseLog}
            stageProgress={stageProgress}
            className="flex-1 min-h-0"
          />
        )}
      </div>
    );
  }

  const currentStageIndex = STAGE_ORDER.indexOf(phase);
  const label = (stageLabels?.[phase] ?? STAGE_LABELS[phase]) || phase;

  return (
    <div className="flex flex-col gap-4 py-3 w-full h-full">
      <StageProgressList
        className="shrink-0 self-center"
        stages={STAGE_ORDER.map((stage, index) => {
          const progress = stageProgress?.[index];
          let status: "complete" | "active" | "pending";
          if (index < currentStageIndex) status = "complete";
          else if (index === currentStageIndex) status = "active";
          else status = "pending";

          return {
            id: stage,
            label: (stageLabels?.[stage] ?? STAGE_LABELS[stage]) || stage,
            status,
            // Only completed stages showed a duration before, and
            // DurationBadge rendered nothing for an undefined ms.
            duration:
              status === "complete" && progress?.durationMs !== undefined
                ? formatDuration(progress.durationMs)
                : undefined,
          };
        })}
      />

      <div className="flex flex-col items-center justify-center gap-2 shrink-0">
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-4 py-2 shadow-sm">
          <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
          <span className="text-base font-semibold text-foreground">
            {label}
          </span>
          <span aria-hidden className="h-4 w-px bg-border" />
          <LiveTimer resetKey={phase} />
        </div>
        <DetailLine text={stepDetail} />
      </div>

      {verboseLog && verboseLog.length > 0 && (
        <VerboseLogPanel
          entries={verboseLog}
          stageProgress={stageProgress}
          className="flex-1 min-h-0"
        />
      )}
    </div>
  );
}
