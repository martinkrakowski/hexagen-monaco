import { Suspense } from "react";
import { Skeleton } from "@hexagen/ui";
import type { StagedPhase, StageProgress } from "../staged-generation-types";
import type { StageValidationReport } from "../useStagedGenerationStream";
import { ThinkingBlock } from "../GenerateWithAi/ThinkingBlock";
import { SPEC_STAGE_LABELS } from "./utils";

interface ManifestGeneratingStepProps {
  generationError: string | null;
  phase: StagedPhase;
  stepDetail: string;
  stageProgress: Record<number, StageProgress>;
  verboseLog?: string[];
  /** Stage-6 advisory review findings on the produced manifest. */
  validationReport?: StageValidationReport | null;
}

export function ManifestGeneratingStep({
  generationError,
  phase,
  stepDetail,
  stageProgress,
  verboseLog,
  validationReport,
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
      {phase === "complete" &&
        validationReport &&
        (validationReport.errors.length > 0 ||
          validationReport.warnings.length > 0) && (
          <div className="mt-3 shrink-0 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
            <p className="font-medium text-foreground">
              Manifest generated — the review found{" "}
              {validationReport.errors.length} issue
              {validationReport.errors.length !== 1 ? "s" : ""}
              {validationReport.warnings.length > 0
                ? ` and ${validationReport.warnings.length} warning${
                    validationReport.warnings.length !== 1 ? "s" : ""
                  }`
                : ""}{" "}
              to address.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              These are advisory — the manifest is produced and usable.
              Structural findings (port quality, naming) won&apos;t change if
              you re-generate; edit the spec or the manifest to resolve them.
            </p>
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-xs">
              {validationReport.errors.map((e, i) => (
                <li key={`e-${i}`} className="text-destructive">
                  • {e}
                </li>
              ))}
              {validationReport.warnings.map((w, i) => (
                <li key={`w-${i}`} className="text-warning">
                  • {w}
                </li>
              ))}
            </ul>
          </div>
        )}
    </>
  );
}
