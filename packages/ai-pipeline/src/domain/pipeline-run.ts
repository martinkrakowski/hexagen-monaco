import type { Identifier } from "@hexagen/shared";
import type { PipelineConfiguration } from "./pipeline-configuration";
import type { ArchitectureModification } from "./architecture-modification";

export type PipelineStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineRun {
  id: Identifier;
  configuration: PipelineConfiguration;
  status: PipelineStatus;
  startTime: number;
  endTime?: number;
  modifications: ArchitectureModification[];
  metadata: Record<string, unknown>;
}

export function createPipelineRun(
  configuration: PipelineConfiguration,
): PipelineRun {
  return {
    id: `pipeline-run-${Date.now()}` as Identifier,
    configuration,
    status: "pending",
    startTime: Date.now(),
    modifications: [],
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

export function addModificationToRun(
  run: PipelineRun,
  modification: ArchitectureModification,
): PipelineRun {
  return {
    ...run,
    modifications: [...run.modifications, modification],
  };
}
