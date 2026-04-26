import type { PipelineStep } from "@hexagen/ai-pipeline";
import type { IntentLineage } from "@hexagen/core-domain";
import type { Result } from "@hexagen/shared";

export interface ModificationResult {
  pipelineRunId: string;
  patchesApplied: number;
  lintPassed: boolean;
  transactionId: string;
  steps: PipelineStep[];
}

export interface ArchitectureModificationPort {
  modifyArchitecture(
    intent: string,
    currentManifestPath: string,
    lineage: IntentLineage,
  ): Promise<Result<ModificationResult, Error>>;
}
