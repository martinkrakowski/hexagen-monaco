/**
 * Contract between POST /api/projects/scan and the import-scan UI.
 *
 * Verdicts are classified from the hexagen scan exit code (0 / 1 / 2). A
 * missing binary or a spawn failure is `could-not-run`, never a silent pass.
 * This module is client-safe: no `node:` imports.
 */

export type ScanVerdict = "pass" | "violations" | "could-not-run";

/**
 * One architectural finding, exactly as `hexagen-lint --json` reports it.
 *
 * Field names are the linter's own (`tools/arch-linter/src/ratchet-baseline.ts`
 * -- `ViolationRecord` for live findings, `BaselineEntry` for baseline-sourced
 * ones), normalised by the CLI's single reader of that contract,
 * `parseLintJson` in packages/sync. They are NOT re-derived here: renaming
 * them on the way through is how a consumer starts silently disagreeing with
 * its producer.
 *
 * `specifier` is `""` for findings that are not import-scoped. `message` is
 * display-only and is `""` for the `stale` / `expired` buckets, which are read
 * out of the baseline file and carry `reason` / `expires` instead.
 */
export interface ScanFinding {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
  readonly message: string;
  readonly reason?: string;
  readonly expires?: string;
}

/**
 * The four buckets the linter partitions violations into, plus whether they
 * were read at all.
 *
 * `collected: false` means the findings could NOT be read -- it does not mean
 * the tree is clean. A renderer must surface `failureReason` in that case and
 * must never present it as "0 findings"; that conflation is the defect class
 * this contract exists to prevent.
 *
 * The linter's `--json` payload also carries `introduced` and `baselineGrowth`.
 * Both are deliberately excluded: the linter only populates them under
 * `--pr-diff`, which needs a base branch to diff against. A freshly imported
 * brownfield tree has none, so they would arrive permanently empty and read as
 * "nothing was introduced" rather than "the question does not apply here".
 */
interface ScanFindingBuckets {
  readonly fresh: readonly ScanFinding[];
  readonly baselined: readonly ScanFinding[];
  readonly stale: readonly ScanFinding[];
  readonly expired: readonly ScanFinding[];
}

/**
 * A discriminated union, not a flat record with an optional reason.
 *
 * `collected: false` with four empty arrays and NO explanation renders as "0
 * findings" -- a clean bill of health for a scan that never ran. That is the
 * false green this seam exists to prevent, so the type makes it unsayable:
 * an uncollected summary must carry a `failureReason`, and a collected one
 * cannot carry one.
 *
 * The previous shape (`collected: boolean` + optional reason) could only be
 * defended by a runtime test, and the test that tried compared two literals
 * to each other and could not fail.
 */
export type ScanFindings =
  | (ScanFindingBuckets & {
      readonly collected: true;
      readonly failureReason?: never;
    })
  | (ScanFindingBuckets & {
      readonly collected: false;
      readonly failureReason: string;
    });

export interface ProjectScanResponse {
  readonly verdict: ScanVerdict;
  readonly exitCode: number | null;
  readonly projectName: string;
  readonly layoutExcerpt: string | null;
  readonly filesScanned: number | null;
  readonly reportMarkdown: string | null;
  readonly errorMessage: string | null;
  /**
   * Findings from the scan envelope's `findings` field.
   *
   * OPTIONAL on purpose, and not because it is unimportant: an older `hexagen`
   * binary on the server's PATH emits an envelope without it, and a response
   * assembled before the CLI ran (a rejected zip, a missing binary) has none
   * either. Absent means "not reported"; `{ collected: false }` means "the CLI
   * tried and could not". A renderer must not treat either as a clean tree.
   */
  readonly findings?: ScanFindings | null;
}
