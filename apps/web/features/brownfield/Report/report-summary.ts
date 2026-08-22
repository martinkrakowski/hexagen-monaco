/**
 * S6 report — the pure view-model transforms (F-20, BF-7.2).
 *
 * NO React, NO fetch, NO storage, NO `Date.now()` read behind the caller's
 * back. Same contract as `../FindingsReview/baseline-draft.ts`, and for the
 * same reason: every sentence this screen prints about what a scan found is
 * decided here, where it can be asserted without a DOM.
 *
 * ## The one thing this screen must never do
 *
 * S6 is the screen that says "here is what we found". It is therefore the
 * screen with the most to lose from the defect the whole scan contract is
 * built around: `collected: false` with four empty arrays renders as "0
 * findings", which is a clean bill of health for a scan that never ran. BF-4.4
 * settled this for S5 and this module reuses ITS reader (`readScanFindings`)
 * and ITS copy (`describeUnavailableFindings`) rather than re-deriving either.
 * A second normalisation of the same three-state field is a second place for
 * the two of them to disagree, and the first time they disagree the product
 * tells somebody their codebase is clean when nobody looked.
 *
 * `describeScanOutcome` checks the failure arms BEFORE it checks the counts,
 * so a `pass` verdict whose findings were never read can never reach the
 * "nothing is failing the gate" branch.
 *
 * ## Where the trend comes from
 *
 * `ScanTrendPoint` is BF-7.1's row shape. It is imported TYPE-ONLY from
 * `lib/platform/scan-records-store`, which is erased at build time
 * (`isolatedModules`), so nothing in that module's graph — `better-sqlite3`,
 * `node:path` — reaches the client bundle. Same move, same direction, as
 * `app/projects/history/RunHistoryPage.tsx`, which type-imports
 * `RunEventRecord` from the same neighbourhood. Mirroring the shape locally
 * was the alternative and was rejected: a hand-copied interface drifts the
 * first time a column is added, and this one is read by a chart.
 *
 * The store's `trend()` already returns the newest N rows flipped to
 * OLDEST-FIRST, tie-broken on rowid. This module does not re-sort them. A
 * defensive re-sort here would silently paper over a store regression and
 * leave the chart looking plausible while being wrong about which scan is the
 * newest — the one fact the "you are here" marker depends on.
 */
import type { ScanTrendPoint } from "../../../lib/platform/scan-records-store";
import type {
  ProjectScanResponse,
  ScanFindings,
} from "@/lib/project-scan/types";
import type { RatchetSparklinePoint } from "@/primitives/RatchetSparkline";
import {
  describeUnavailableFindings,
  readScanFindings,
  summarizeFindingsSource,
  type FindingsSourceCounts,
} from "../FindingsReview/baseline-draft";

/**
 * What the report says happened, as a finished title/description pair plus the
 * discriminant a view keys its icon and tone off.
 *
 * Copy lives here rather than in the view for the same reason it does on S5:
 * "did this scan actually tell us anything?" is a question with one right
 * answer, and a view that assembled the sentence itself would be a second
 * place to get it wrong.
 */
export type ScanReportOutcomeKind =
  | "could-not-run"
  | "unreadable"
  | "inconsistent"
  | "clean"
  | "violations";

export interface ScanReportOutcome {
  readonly kind: ScanReportOutcomeKind;
  readonly title: string;
  readonly description: string;
  /**
   * True only when the scan produced a trustworthy answer — clean or not.
   * Everything the screen gates (the gate installer, the trend's claim to mean
   * anything) hangs off this rather than off `verdict === "pass"`.
   */
  readonly trustworthy: boolean;
}

/**
 * Classifies the scan. ORDER IS THE CONTRACT.
 *
 *  1. the scan could not run at all — no counts exist, trustworthy or not;
 *  2. the findings were not read (`collected: false`, or absent entirely) —
 *     BF-4.4's copy, verbatim, because it is the same claim;
 *  3. the verdict and the counts disagree — reported as a disagreement, never
 *     resolved in favour of whichever one looks better;
 *  4. read, and nothing fresh — genuinely clean;
 *  5. read, with fresh findings.
 *
 * Steps 1 and 2 precede every count-bearing branch. That ordering is what
 * stops a `pass` verdict on an unread findings list from printing "nothing is
 * failing the gate".
 */
export function describeScanOutcome(
  scan: Pick<ProjectScanResponse, "verdict" | "errorMessage"> & {
    readonly findings?: ScanFindings | null;
  },
): ScanReportOutcome {
  if (scan.verdict === "could-not-run") {
    const stated = (scan.errorMessage ?? "").trim();
    return {
      kind: "could-not-run",
      title: "The scan could not run",
      description:
        stated === ""
          ? "No findings were produced, and no reason was reported. Nothing here says anything about the state of the codebase."
          : `The scan reported: ${stated}. No findings were produced, so nothing here says anything about the state of the codebase.`,
      trustworthy: false,
    };
  }

  const source = readScanFindings(scan.findings);
  const unavailable = describeUnavailableFindings(source);
  if (unavailable !== null) {
    return {
      kind: "unreadable",
      title: unavailable.title,
      description: unavailable.description,
      trustworthy: false,
    };
  }

  // `source.kind === "collected"` from here: describeUnavailableFindings
  // returns null for exactly that arm.
  const counts = summarizeFindingsSource(source);
  const fresh = counts?.fresh ?? 0;

  if (scan.verdict === "violations" && fresh === 0) {
    return {
      kind: "inconsistent",
      title: "The scan's verdict and its findings do not agree",
      description:
        "The scan exited as if the gate had failed, but the findings list it sent back is empty. One of the two is wrong, and there is no way to tell which from here — treat this as a scan that did not report properly and run it again rather than as a clean tree.",
      trustworthy: false,
    };
  }

  if (fresh === 0) {
    return {
      kind: "clean",
      title: "Nothing is failing the gate",
      description:
        "The scan read the findings and none of them are failing. Installing the gate now keeps it that way — the next change that breaks the architecture will fail CI instead of landing.",
      trustworthy: true,
    };
  }

  return {
    kind: "violations",
    title:
      fresh === 1
        ? "1 finding is failing the gate"
        : `${fresh} findings are failing the gate`,
    description:
      "Everything you accepted on the previous screen is recorded as pre-existing debt and will stop failing. Anything left enforced keeps failing until it is fixed.",
    trustworthy: true,
  };
}

/**
 * How many files the scan actually read, in words.
 *
 * `null` and `0` are DIFFERENT and neither is "fine". `null` means the number
 * was never reported; `0` means the scan looked at nothing, which is the
 * quietest possible way for a scan to be useless. Rendering both as a bare
 * dash was the obvious shortcut and is exactly how a zero-file scan gets read
 * as a clean one.
 */
export function describeFilesScanned(filesScanned: number | null): string {
  if (filesScanned === null || !Number.isFinite(filesScanned)) {
    return "The scan did not report how many files it read.";
  }
  if (filesScanned <= 0) {
    return "The scan read no files at all, so its findings describe nothing.";
  }
  return filesScanned === 1
    ? "1 file scanned."
    : `${filesScanned} files scanned.`;
}

// ─── timestamps ───────────────────────────────────────────────────────────────

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * `1755691320000` -> `"20 Aug 2026, 14:02 UTC"`.
 *
 * Hand-rolled in UTC rather than `toLocaleString()`, deliberately. The report
 * is server-rendered and hydrated: `toLocaleString` resolves against the
 * host's timezone and locale, so the server and the browser produce different
 * strings for the same millisecond and React reports a hydration mismatch —
 * and the row labels are also the accessible names of the trend table's rows,
 * so a mismatch there is a mismatch in what a screen reader announces. UTC is
 * stated in the string rather than implied, because a timestamp with no zone
 * is a timestamp somebody will misread by a working day.
 */
export function formatScanTimestamp(createdAt: number): string {
  if (!Number.isFinite(createdAt)) return "unknown time";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}, ${pad2(date.getUTCHours())}:${pad2(
    date.getUTCMinutes(),
  )} UTC`;
}

// ─── the ratchet trend ────────────────────────────────────────────────────────

export interface RatchetTrend {
  /** Sparkline input, oldest first, one entry per stored scan. */
  readonly points: readonly RatchetSparklinePoint[];
  /** Points carrying a usable number. Fewer than two means no chart. */
  readonly measuredCount: number;
  /** Points whose scan could not run. Never plotted; drawn as gaps. */
  readonly unmeasuredCount: number;
  /** Accessible name for the trend table. */
  readonly label: string;
  /** Shown when no scan has been recorded at all. */
  readonly emptyLabel: string;
  /** Visible sentence under the chart, or `null` when there is nothing to say. */
  readonly summary: string | null;
  /** Replaces the chart when fewer than two points are measured. */
  readonly insufficientLabel: string | null;
}

/**
 * Turns stored scan rows into sparkline input.
 *
 * THE RULE THAT MATTERS: a scan whose verdict is `could-not-run` contributes
 * NO VALUE. Its `findings_fresh` column is 0 because nothing counted it, not
 * because nothing was found, and plotting that 0 draws a collapse to zero
 * findings — the single most encouraging shape this chart can make, produced
 * by the single least informative event it can record. It keeps its slot on
 * the x-axis as a gap so the run is not silently shortened, and the table says
 * in words that it could not run.
 *
 * This is the trend-shaped version of the same three-state problem
 * `readScanFindings` solves for one scan. It is decided here rather than in
 * `RatchetSparkline` because the sparkline is a neutral component that knows
 * nothing about verdicts — it is handed numbers and holes.
 *
 * `fresh` is the plotted series rather than `fresh + baselined`: fresh is what
 * fails the gate today, so it is the number the ratchet is about. Baselined
 * debt is real but it is accepted, and folding it in would make a successful
 * baselining session look like a regression.
 */
export function buildRatchetTrend(
  trend: readonly ScanTrendPoint[],
): RatchetTrend {
  const label = "Findings failing the gate, by scan, oldest first";
  const emptyLabel =
    "No scan has been recorded for this project yet, so there is no ratchet history to show. This run will be the first point on it.";

  const points: RatchetSparklinePoint[] = trend.map((row) => {
    const unmeasured = row.verdict === "could-not-run";
    return {
      id: row.id,
      label: formatScanTimestamp(row.createdAt),
      value: unmeasured ? null : row.fresh,
      note: unmeasured ? "the scan could not run" : undefined,
    };
  });

  const measured = points.filter(
    (point) => typeof point.value === "number" && Number.isFinite(point.value),
  );
  const measuredCount = measured.length;
  const unmeasuredCount = points.length - measuredCount;

  if (points.length === 0) {
    return {
      points,
      measuredCount,
      unmeasuredCount,
      label,
      emptyLabel,
      summary: null,
      insufficientLabel: null,
    };
  }

  const gapNote =
    unmeasuredCount === 0
      ? ""
      : unmeasuredCount === 1
        ? " One scan could not run and is shown as a gap rather than a zero."
        : ` ${unmeasuredCount} scans could not run and are shown as gaps rather than zeroes.`;

  if (measuredCount === 0) {
    return {
      points,
      measuredCount,
      unmeasuredCount,
      label,
      emptyLabel,
      summary: null,
      insufficientLabel: `None of the last ${points.length} ${
        points.length === 1 ? "scan" : "scans"
      } produced a usable count, so there is no trend to draw.`,
    };
  }

  if (measuredCount === 1) {
    const only = measured[0].value as number;
    return {
      points,
      measuredCount,
      unmeasuredCount,
      label,
      emptyLabel,
      summary: null,
      insufficientLabel: `Only one scan so far produced a usable count (${only} failing the gate), so there is nothing to compare it with yet. A trend needs two.${gapNote}`,
    };
  }

  const first = measured[0].value as number;
  const last = measured[measuredCount - 1].value as number;
  const scans = `${points.length} ${points.length === 1 ? "scan" : "scans"}`;
  const movement =
    last < first
      ? `Findings failing the gate fell from ${first} to ${last} across the last ${scans}.`
      : last > first
        ? `Findings failing the gate rose from ${first} to ${last} across the last ${scans}.`
        : `Findings failing the gate have stayed at ${last} across the last ${scans}.`;

  return {
    points,
    measuredCount,
    unmeasuredCount,
    label,
    emptyLabel,
    summary: `${movement}${gapNote}`,
    insufficientLabel: null,
  };
}

// ─── the whole screen ─────────────────────────────────────────────────────────

export interface ScanReportModel {
  readonly projectName: string;
  readonly outcome: ScanReportOutcome;
  /** Bucket totals, or `null` when the findings were never read. */
  readonly counts: FindingsSourceCounts | null;
  readonly filesScannedLabel: string;
  /** The CLI's own report, verbatim, or `null`. Never summarised here. */
  readonly reportMarkdown: string | null;
  readonly trend: RatchetTrend;
  /** False when the scan produced nothing worth installing a gate from. */
  readonly canInstallGate: boolean;
  /** Why the installer is unavailable, phrased for the user, or `null`. */
  readonly gateBlockedReason: string | null;
}

export interface BuildScanReportInput {
  readonly scan: ProjectScanResponse;
  /** BF-7.1's `trend()` output, oldest first. Passed through unsorted. */
  readonly trend?: readonly ScanTrendPoint[];
}

/**
 * Assembles everything S6 renders.
 *
 * `canInstallGate` is derived from `outcome.trustworthy`, not from the
 * verdict. The gate installer writes `.architecture/` plus a baseline into
 * somebody's repository; doing that from a scan that could not run, or whose
 * findings were never read, ships a baseline asserting a state nobody
 * measured. S5 already refuses to ratify those arms — this is the same refusal
 * at the last screen that can still make it, and it carries a stated reason
 * rather than a silently disabled button.
 */
export function buildScanReport({
  scan,
  trend = [],
}: BuildScanReportInput): ScanReportModel {
  const outcome = describeScanOutcome(scan);
  const source = readScanFindings(scan.findings);

  return {
    projectName: scan.projectName,
    outcome,
    // Counts ONLY when the outcome is trustworthy.
    //
    // `summarizeFindingsSource` already returns null when the findings were
    // never collected, which covers the `unreadable` arm. It does NOT cover
    // the other two untrustworthy arms, and one of them is deterministic
    // rather than hypothetical:
    //
    //   `inconsistent` -- verdict "violations" with 0 fresh findings. counts
    //   is a real object of zeroes, so the screen printed four 0 pills
    //   directly under a heading saying the verdict and the findings do not
    //   agree. Zeroes read as a clean bill of health at a glance, which is
    //   precisely the false green this arc exists to prevent, and here the
    //   screen contradicted itself in two adjacent elements.
    //
    //   `could-not-run` -- classified before the findings are read, so an
    //   inconsistent payload carrying a collected findings blob would show
    //   pills for a scan that reported it never ran.
    //
    // Deriving from `outcome.trustworthy` ties the pills to the same
    // predicate as `canInstallGate`, so the screen cannot offer counts it
    // would refuse to install a gate from.
    counts: outcome.trustworthy ? summarizeFindingsSource(source) : null,
    filesScannedLabel: describeFilesScanned(scan.filesScanned),
    reportMarkdown: scan.reportMarkdown,
    trend: buildRatchetTrend(trend),
    canInstallGate: outcome.trustworthy,
    gateBlockedReason: outcome.trustworthy
      ? null
      : "The gate is installed from what this scan found, and this scan did not produce a usable result. Run it again before installing anything.",
  };
}
