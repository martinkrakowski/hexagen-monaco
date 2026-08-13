import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import type { StageValidationReport } from "../useStagedGenerationStream";
import { ValidationFindingsPanel } from "../ValidationFindingsPanel";
import { ThinkingBlock } from "./ThinkingBlock";

interface AiGeneratingStepProps {
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog?: string[];
  /**
   * Stage-6 advisory review findings on the produced manifest — same report
   * and same presentation as the /spec import flow (ValidationFindingsPanel).
   */
  validationReport?: StageValidationReport | null;
}

/**
 * Dedicated full-height generation view for the "Generate with AI" flow.
 * Mirrors `import-project-spec/ManifestGeneratingStep` but uses ThinkingBlock's
 * built-in AI stage labels (no `stageLabels` override). Errors are handled by
 * the parent form — the generating screen only mounts while there is no error —
 * so this view intentionally has no error banner.
 */
export function AiGeneratingStep({
  phase,
  stepDetail,
  stageProgress,
  verboseLog,
  validationReport,
}: AiGeneratingStepProps) {
  return (
    <>
      <h2 className="text-xl font-semibold mb-3 shrink-0">
        Generating Manifest
      </h2>
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
      {phase === "complete" && validationReport && (
        <ValidationFindingsPanel
          validationReport={validationReport}
          // /stage has no source spec to re-import — the remedy must point at
          // the manifest / prompt instead (/spec keeps the panel's default).
          intendedItemRemedy="edit the manifest after proceeding, or adjust your prompt and generate again."
        />
      )}
    </>
  );
}
