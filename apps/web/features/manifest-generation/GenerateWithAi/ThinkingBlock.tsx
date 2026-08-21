"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Check } from "lucide-react";
import { StageProgressList } from "../../../components/StageProgressList";
import type { StagedPhase, StageProgress } from "../staged-generation-types";

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

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function DetailLine({ text }: { text: string }) {
  const prevText = useRef<string | undefined>(undefined);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (prevText.current === undefined || prevText.current === text) return;
    setIsTransitioning(true);
    const t = setTimeout(() => setIsTransitioning(false), 400);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    prevText.current = text;
  }, [text]);

  return (
    <div className="relative overflow-hidden h-5">
      {isTransitioning && prevText.current !== undefined && (
        <div className="detail-rolodex-exit absolute inset-x-0 top-0">
          <span className="text-sm text-foreground/70">{prevText.current}</span>
        </div>
      )}
      <div className={isTransitioning ? "detail-rolodex-enter" : ""}>
        <span className="text-sm text-foreground/70">{text}</span>
      </div>
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
          <pre className="p-3 text-xs font-mono text-muted-foreground overflow-x-auto rounded-md border border-border/50 bg-muted/20">
            {verboseLog.join("\n")}
          </pre>
        )}
      </div>
    );
  }

  const currentStageIndex = STAGE_ORDER.indexOf(phase);
  const label = (stageLabels?.[phase] ?? STAGE_LABELS[phase]) || phase;

  const stages = STAGE_ORDER.map((stage, index) => {
    const stageNum = index;
    const progress = stageProgress?.[stageNum];
    let status: "complete" | "active" | "pending";
    if (index < currentStageIndex) status = "complete";
    else if (index === currentStageIndex) status = "active";
    else status = "pending";

    return {
      id: stage,
      label: (stageLabels?.[stage] ?? STAGE_LABELS[stage]) || stage,
      status,
      duration: progress?.durationMs
        ? formatDuration(progress.durationMs)
        : undefined,
    };
  });

  return (
    <div className="flex flex-col gap-4 py-3 w-full h-full">
      <StageProgressList stages={stages} logContent={verboseLog?.join("\n")} />

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
    </div>
  );
}

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
