import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
import { CheckCircle2 } from "lucide-react";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import type {
  StageValidationReport,
  StageRepairSummary,
} from "../useStagedGenerationStream";
import { ThinkingBlock } from "../GenerateWithAi/ThinkingBlock";
import {
  ValidationFindingsPanel,
  splitReviewFindings,
} from "../ValidationFindingsPanel";
import { SPEC_STAGE_LABELS } from "./utils";

interface ManifestGeneratingStepProps {
  generationError: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog?: string[];
  /** Stage-6 advisory review findings on the produced manifest. */
  validationReport?: StageValidationReport | null;
  /** Stage-7 verify-and-repair outcome, when the reviewer model ran. */
  repairSummary?: StageRepairSummary | null;
}

export function ManifestGeneratingStep({
  generationError,
  phase,
  stepDetail,
  stageProgress,
  verboseLog,
  validationReport,
  repairSummary,
}: ManifestGeneratingStepProps) {
  // Findings/notices split shared with the /stage flow's AiGeneratingStep —
  // see ValidationFindingsPanel (extracted from here, markup unchanged).
  const { hasFindings } = splitReviewFindings(validationReport);
  // Stage-6 findings are ADVISORY: generation succeeding means the manifest is
  // produced, valid, and ready to accept. Only a real generation/accept error
  // makes this step a failure — the summary must lead with success, not with
  // findings (users read the old findings-first panel as "generated with
  // errors" and didn't realize they could proceed).
  const isSuccess = phase === "complete" && !generationError;

  return (
    <>
      <h2 className="text-xl font-semibold mb-3 shrink-0">
        {isSuccess ? "Manifest Generated" : "Generating Manifest"}
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
      {isSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 shrink-0 rounded-md border border-success/20 bg-success/10 p-4 text-sm"
        >
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Manifest generated successfully — ready to review.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Continue with <span className="font-medium">Next</span> to review
            and accept it.
            {hasFindings &&
              " The review notes below are optional improvements — the manifest is valid to use as-is."}
          </p>
        </div>
      )}
      {phase === "complete" && validationReport && (
        <ValidationFindingsPanel
          validationReport={validationReport}
          repairSummary={repairSummary}
        />
      )}
    </>
  );
}
