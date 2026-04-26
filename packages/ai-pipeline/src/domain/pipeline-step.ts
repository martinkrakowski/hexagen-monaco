export type PipelineStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface PipelineStep {
  readonly name: string;
  readonly status: PipelineStepStatus;
  readonly startTime: number;
  readonly endTime?: number;
  readonly error?: string;
  readonly metadata: Record<string, unknown>;
}

export function createPipelineStep(
  name: string,
  metadata: Record<string, unknown> = {},
): PipelineStep {
  return {
    name,
    status: "pending",
    startTime: Date.now(),
    metadata,
  };
}

export function startStep(step: PipelineStep): PipelineStep {
  return {
    ...step,
    status: "running",
    startTime: Date.now(),
  };
}

export function completeStep(step: PipelineStep): PipelineStep {
  return {
    ...step,
    status: "completed",
    endTime: Date.now(),
  };
}

export function failStep(step: PipelineStep, error: string): PipelineStep {
  return {
    ...step,
    status: "failed",
    endTime: Date.now(),
    error,
  };
}

export function skipStep(step: PipelineStep, reason?: string): PipelineStep {
  return {
    ...step,
    status: "skipped",
    endTime: Date.now(),
    metadata: { ...step.metadata, skipReason: reason },
  };
}

export function stepDurationMs(step: PipelineStep): number | undefined {
  if (step.endTime === undefined) return undefined;
  return step.endTime - step.startTime;
}
