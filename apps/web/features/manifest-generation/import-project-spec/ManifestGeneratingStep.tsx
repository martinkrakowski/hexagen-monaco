import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import { ThinkingBlock } from "../GenerateWithAi/ThinkingBlock";
import { SPEC_STAGE_LABELS } from "./utils";

interface ManifestGeneratingStepProps {
  generationError: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog?: string[];
}

export function ManifestGeneratingStep({
  generationError,
  phase,
  stepDetail,
  stageProgress,
  verboseLog,
}: ManifestGeneratingStepProps) {
  return (
    <>
      <h2 className="text-xl font-semibold mb-3 shrink-0">
        Generating Manifest
      </h2>
      {generationError && (
        <div className="mb-3 p-4 bg-destructive/10 text-destructive rounded shrink-0">
          Error: {generationError}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-32 w-48" />
              <Skeleton className="h-96 w-full" />
            </div>
          }
        >
          <ThinkingBlock
            phase={phase}
            stepDetail={stepDetail}
            stageProgress={stageProgress}
            stageLabels={SPEC_STAGE_LABELS}
            verboseLog={verboseLog}
          />
        </Suspense>
      </div>
    </>
  );
}
