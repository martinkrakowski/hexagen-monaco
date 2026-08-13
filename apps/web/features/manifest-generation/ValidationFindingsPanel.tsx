import type {
  StageValidationReport,
  StageRepairSummary,
} from "./useStagedGenerationStream";
import {
  describeFindings,
  isAutoAppliedNotice,
} from "./import-project-spec/utils";

/**
 * Splits a Stage-6 report's `warnings` into the reviewer's actual findings
 * (suggestions the user MAY act on) and the pipeline's auto-applied advisories
 * (informational — already done). See isAutoAppliedNotice.
 */
export function splitReviewFindings(
  validationReport: StageValidationReport | null | undefined,
): {
  reviewWarnings: string[];
  notices: string[];
  errorCount: number;
  hasFindings: boolean;
  hasNotices: boolean;
} {
  const reviewWarnings =
    validationReport?.warnings.filter((w) => !isAutoAppliedNotice(w)) ?? [];
  const notices = validationReport?.warnings.filter(isAutoAppliedNotice) ?? [];
  const errorCount = validationReport?.errors.length ?? 0;
  return {
    reviewWarnings,
    notices,
    errorCount,
    hasFindings: errorCount > 0 || reviewWarnings.length > 0,
    hasNotices: notices.length > 0,
  };
}

interface ValidationFindingsPanelProps {
  /** Stage-6 advisory review findings on the produced manifest. */
  validationReport: StageValidationReport;
  /** Stage-7 verify-and-repair outcome, when the reviewer model ran. */
  repairSummary?: StageRepairSummary | null;
}

/**
 * Advisory Stage-6 findings panel — findings (optional improvements) and
 * auto-applied adjustments, success-first framing. Extracted verbatim from
 * `import-project-spec/ManifestGeneratingStep` so the /spec import flow and
 * the /stage prompt flow render the SAME report with the SAME presentation
 * (parity, not redesign). Renders nothing when the report carries no
 * findings and no notices.
 */
export function ValidationFindingsPanel({
  validationReport,
  repairSummary,
}: ValidationFindingsPanelProps) {
  const { reviewWarnings, notices, errorCount, hasFindings, hasNotices } =
    splitReviewFindings(validationReport);

  if (!hasFindings && !hasNotices) return null;

  return (
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
            re-generate; edit the spec or the manifest if you want to resolve
            them.
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
            No action needed to proceed — these note what the generator adjusted
            to keep the manifest valid. If any dropped or renamed item was
            intended, correct it in your source spec and re-import.
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
  );
}
