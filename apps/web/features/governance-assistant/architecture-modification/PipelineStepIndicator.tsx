"use client";

import { CheckCircle, Loader2, XCircle, Circle } from "lucide-react";
import type { StepProgress } from "../hooks/useArchitectureModification";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";

interface PipelineStepIndicatorProps {
  steps: StepProgress[];
}

const STEP_LABELS: Record<string, string> = {
  "parse-nl-intent": "Parse Intent",
  "compile-prompt": "Compile Prompt",
  "llm-inference": "LLM Inference",
  reconcile: "Reconcile",
  "commit-patches": "Commit Patches",
};

function StepIcon({ status }: { status: PipelineStepStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-success shrink-0" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    case "skipped":
      return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />;
  }
}

function StepRow({ step, isLast }: { step: StepProgress; isLast: boolean }) {
  const label = STEP_LABELS[step.name] ?? step.name;
  const duration = step.durationMs !== null ? `${step.durationMs}ms` : null;

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center">
        <StepIcon status={step.status} />
        {!isLast && <div className="w-px h-4 mt-1 bg-border" />}
      </div>
      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`text-sm font-medium ${
              step.status === "running"
                ? "text-foreground"
                : step.status === "completed"
                  ? "text-foreground"
                  : step.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
            }`}
          >
            {label}
          </span>
          {duration && (
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {duration}
            </span>
          )}
        </div>
        {step.status === "running" && (
          <p className="text-xs text-muted-foreground mt-0.5">Processing...</p>
        )}
      </div>
    </div>
  );
}

export function PipelineStepIndicator({ steps }: PipelineStepIndicatorProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-0">
      {steps.map((step, i) => (
        <StepRow key={step.name} step={step} isLast={i === steps.length - 1} />
      ))}
    </div>
  );
}

export { STEP_LABELS };
