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
  SPEC_STAGE_LABELS,
  describeFindings,
  isAutoAppliedNotice,
} from "./utils";

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
  // Split the Stage-6 report's `warnings` into the reviewer's actual findings
  // (suggestions the user MAY act on) and the pipeline's auto-applied advisories
  // (informational — already done). See isAutoAppliedNotice.
  const reviewWarnings =
    validationReport?.warnings.filter((w) => !isAutoAppliedNotice(w)) ?? [];
  const notices = validationReport?.warnings.filter(isAutoAppliedNotice) ?? [];
  const errorCount = validationReport?.errors.length ?? 0;
  const hasFindings = errorCount > 0 || reviewWarnings.length > 0;
  const hasNotices = notices.length > 0;
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
      {phase === "complete" &&
        validationReport &&
        (hasFindings || hasNotices) && (
          <div className="mt-3 shrink-0 rounded-md border border-border bg-muted/30 p-4 text-sm">
            {repairSummary?.attempted && (
              <p className="mb-2 text-xs text-muted-foreground">
                {repairSummary.applied
                  ? `The reviewer model resolved ${
                      repairSummary.errorsBefore - repairSummary.errorsAfter
                    } of ${repairSummary.errorsBefore} finding${
                      repairSummary.errorsBefore !== 1 ? "s" : ""
                    } automatically — ${repairSummary.errorsAfter} remain as advisory notes.`
                  : "The reviewer model reviewed the findings; the original manifest was kept and the notes below remain advisory."}
              </p>
            )}

            {hasFindings && (
              <details>
                <summary className="cursor-pointer font-medium text-foreground">
                  {describeFindings(errorCount, reviewWarnings.length)} from the
                  review — optional improvements
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  These are advisory and don&apos;t block anything. Structural
                  findings (port quality, naming) won&apos;t change if you
                  re-generate; edit the spec or the manifest if you want to
                  resolve them.
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
                  {validationReport.errors.map((e, i) => (
                    <li key={`e-${i}`} className="text-warning">
                      • {e}
                    </li>
                  ))}
                  {reviewWarnings.map((w, i) => (
                    <li key={`w-${i}`} className="text-muted-foreground">
                      • {w}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {hasNotices && (
              <details className={hasFindings ? "mt-3" : ""}>
                <summary className="cursor-pointer font-medium text-foreground">
                  {notices.length === 1
                    ? "1 adjustment was"
                    : `${notices.length} adjustments were`}{" "}
                  applied automatically to keep the manifest valid
                </summary>
                <p className="mt-1 text-xs text-muted-foreground">
                  No action needed — these note what the generator changed.
                  Rename in the manifest if you&apos;d prefer different names.
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
                  {notices.map((n, i) => (
                    <li key={`n-${i}`} className="text-muted-foreground">
                      • {n}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
    </>
  );
}
