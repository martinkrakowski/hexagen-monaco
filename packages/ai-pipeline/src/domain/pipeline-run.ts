import type { Identifier } from "@hexagen/shared";

export type PipelineStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineRun {
  id: Identifier;
  status: PipelineStatus;
  startTime: number;
  endTime?: number;
  metadata: Record<string, unknown>;
}

export function createPipelineRun(): PipelineRun {
  return {
    id: `pipeline-run-${Date.now()}` as Identifier,
    status: "pending",
    startTime: Date.now(),
    metadata: {},
  };
}

export function updatePipelineRunStatus(
  run: PipelineRun,
  status: PipelineStatus,
): PipelineRun {
  return {
    ...run,
    status,
    endTime:
      status === "completed" || status === "failed" ? Date.now() : run.endTime,
  };
}
