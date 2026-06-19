import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
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
  // (actionable — "edit to resolve") and the pipeline's auto-applied advisories
  // (informational — already done). See isAutoAppliedNotice.
  const reviewWarnings =
    validationReport?.warnings.filter((w) => !isAutoAppliedNotice(w)) ?? [];
  const notices = validationReport?.warnings.filter(isAutoAppliedNotice) ?? [];
  const errorCount = validationReport?.errors.length ?? 0;
  const hasFindings = errorCount > 0 || reviewWarnings.length > 0;
  const hasNotices = notices.length > 0;

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
      {phase === "complete" &&
        validationReport &&
        (hasFindings || hasNotices) && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-3 shrink-0 rounded-md border p-4 text-sm ${
              hasFindings
                ? "border-warning/30 bg-warning/5"
                : "border-border bg-muted/30"
            }`}
          >
            {repairSummary?.attempted && (
              <p className="mb-2 font-medium text-foreground">
                {repairSummary.applied
                  ? `The reviewer model repaired ${
                      repairSummary.errorsBefore - repairSummary.errorsAfter
                    } of ${repairSummary.errorsBefore} error${
                      repairSummary.errorsBefore !== 1 ? "s" : ""
                    } — ${repairSummary.errorsAfter} remain.`
                  : "The reviewer model attempted a repair but couldn't reduce the errors; showing the original manifest."}
              </p>
            )}

            {hasFindings && (
              <>
                <p className="font-medium text-foreground">
                  Manifest generated — the review found{" "}
                  {describeFindings(errorCount, reviewWarnings.length)} to
                  address.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  These are advisory — the manifest is produced and usable.
                  Structural findings (port quality, naming) won&apos;t change
                  if you re-generate; edit the spec or the manifest to resolve
                  them.
                </p>
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
                  {validationReport.errors.map((e, i) => (
                    <li key={`e-${i}`} className="text-destructive">
                      • {e}
                    </li>
                  ))}
                  {reviewWarnings.map((w, i) => (
                    <li key={`w-${i}`} className="text-warning">
                      • {w}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {hasNotices && (
              <div
                className={
                  hasFindings ? "mt-4 border-t border-border/50 pt-3" : ""
                }
              >
                <p className="font-medium text-foreground">
                  {notices.length === 1
                    ? "1 adjustment was"
                    : `${notices.length} adjustments were`}{" "}
                  applied automatically to keep the manifest valid.
                </p>
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
              </div>
            )}
          </div>
        )}
    </>
  );
}
