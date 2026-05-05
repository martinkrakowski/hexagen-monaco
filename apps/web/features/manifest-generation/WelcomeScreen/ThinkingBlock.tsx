"use client";

import { useRef, useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { StagedPhase, StageProgress } from "../useStagedManifestGeneration";

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
}

function StepIndicator({
  state,
}: {
  state: "completed" | "active" | "pending";
}) {
  if (state === "completed") {
    return (
      <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
        <Check className="w-3 h-3 text-accent" />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="w-4 h-4 rounded-full bg-accent flex items-center justify-center shrink-0 step-dot-active">
        <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
      </div>
    );
  }
  return (
    <div className="w-4 h-4 rounded-full border border-muted-foreground/20 shrink-0" />
  );
}

function DetailLine({ text }: { text: string }) {
  const prevText = usePrevious(text);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (prevText !== undefined && prevText !== text) {
      setIsTransitioning(true);
      const t = setTimeout(() => setIsTransitioning(false), 400);
      setTimer(t);
      return () => clearTimeout(t);
    }
  }, [text, prevText]);

  useEffect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timer]);

  return (
    <div className="relative overflow-hidden h-5">
      {isTransitioning && prevText !== undefined && (
        <div className="detail-rolodex-exit absolute inset-x-0 top-0">
          <span className="text-sm text-muted-foreground">{prevText}</span>
        </div>
      )}
      <div className={isTransitioning ? "detail-rolodex-enter" : ""}>
        <span className="text-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  );
}

function DurationBadge({ ms }: { ms?: number }) {
  if (ms === undefined) return null;
  const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
  return (
    <span className="text-xs text-muted-foreground/60 tabular-nums">
      {label}
    </span>
  );
}

export function ThinkingBlock({ phase, stepDetail, stageProgress }: ThinkingBlockProps) {
  if (phase === "idle" || phase === "failed") return null;

  if (phase === "complete") {
    return (
      <div className="flex flex-col items-center gap-2 py-3">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-accent" />
          <span className="text-base font-semibold text-foreground">
            Generation Complete
          </span>
        </div>
      </div>
    );
  }

  const currentStageIndex = STAGE_ORDER.indexOf(phase);
  const label = STAGE_LABELS[phase];

  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <div className="flex items-center gap-1.5">
        {STAGE_ORDER.map((stage, index) => {
          const stageNum = index;
          const progress = stageProgress?.[stageNum];
          let dotState: "completed" | "active" | "pending";
          if (index < currentStageIndex) dotState = "completed";
          else if (index === currentStageIndex) dotState = "active";
          else dotState = "pending";

          return (
            <div key={stage} className="flex items-center gap-1.5">
              <StepIndicator state={dotState} />
              {dotState === "completed" && (
                <DurationBadge ms={progress?.durationMs} />
              )}
              {index < STAGE_ORDER.length - 1 && (
                <div className="w-4 h-px bg-border" />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center justify-center gap-1.5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 text-accent animate-spin" />
          <span className="text-base font-semibold text-foreground">
            {label}
          </span>
        </div>
        <DetailLine text={stepDetail} />
      </div>
    </div>
  );
}
