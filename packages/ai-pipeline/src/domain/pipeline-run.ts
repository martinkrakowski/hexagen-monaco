import type { PipelineStep } from "./pipeline-step.js";

export type PipelineRunStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineRun {
  readonly id: string;
  readonly intent: string;
  readonly status: PipelineRunStatus;
  readonly steps: PipelineStep[];
  readonly createdAt: number;
  readonly completedAt?: number;
}

export function createPipelineRun(
  id: string,
  intent: string,
  steps: PipelineStep[] = [],
): PipelineRun {
  return {
    id,
    intent,
    status: "pending",
    steps,
    createdAt: Date.now(),
  };
}

export function startRun(run: PipelineRun): PipelineRun {
  return {
    ...run,
    status: "running",
  };
}

export function completeRun(run: PipelineRun): PipelineRun {
  return {
    ...run,
    status: "completed",
    completedAt: Date.now(),
  };
}

export function failRun(run: PipelineRun): PipelineRun {
  return {
    ...run,
    status: "failed",
    completedAt: Date.now(),
  };
}

export function updateRunStep(
  run: PipelineRun,
  stepName: string,
  updater: (step: PipelineStep) => PipelineStep,
): PipelineRun {
  const steps = run.steps.map((s) => (s.name === stepName ? updater(s) : s));
  return { ...run, steps };
}

export function addRunStep(run: PipelineRun, step: PipelineStep): PipelineRun {
  return { ...run, steps: [...run.steps, step] };
}
