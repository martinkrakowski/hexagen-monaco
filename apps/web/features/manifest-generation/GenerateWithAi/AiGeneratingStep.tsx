import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import { ThinkingBlock } from "./ThinkingBlock";

interface AiGeneratingStepProps {
  generationError: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog?: string[];
}

/**
 * Dedicated full-height generation view for the "Generate with AI" flow.
 * Mirrors `import-project-spec/ManifestGeneratingStep`, but uses ThinkingBlock's
 * built-in AI stage labels (no `stageLabels` override).
 */
export function AiGeneratingStep({
  generationError,
  phase,
  stepDetail,
  stageProgress,
  verboseLog,
}: AiGeneratingStepProps) {
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
            verboseLog={verboseLog}
          />
        </Suspense>
      </div>
    </>
  );
}
