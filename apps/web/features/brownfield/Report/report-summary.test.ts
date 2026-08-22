/**
 * S6 report transforms (F-20, BF-7.2).
 *
 * The load-bearing assertions here are the ones about what the screen REFUSES
 * to say: no "0 findings" for a scan that could not run, no clean bill of
 * health for an unread findings list, and no plotted zero for a scan that
 * never produced a count.
 */
import { describe, it, expect } from "vitest";

import type {
  ProjectScanResponse,
  ScanFindings,
} from "@/lib/project-scan/types";
import type { ScanTrendPoint } from "../../../lib/platform/scan-records-store";
import {
  buildRatchetTrend,
  buildScanReport,
  describeFilesScanned,
  describeScanOutcome,
  formatScanTimestamp,
} from "./report-summary";

function collected(fresh: number): ScanFindings {
  return {
    collected: true,
    fresh: Array.from({ length: fresh }, (_unused, index) => ({
      rule: "cross-package-import",
      file: `packages/a/src/domain/f${index}.ts`,
      specifier: "@acme/b",
      message: "cross-package import",
    })),
    baselined: [],
    stale: [],
    expired: [],
  };
}

function scan(
  overrides: Partial<ProjectScanResponse> = {},
): ProjectScanResponse {
  return {
    verdict: "violations",
    exitCode: 1,
    projectName: "checkout-service",
    layoutExcerpt: null,
    filesScanned: 2481,
    reportMarkdown: null,
    errorMessage: null,
    findings: collected(3),
    ...overrides,
  };
}

function trendPoint(
  id: string,
  createdAt: number,
  fresh: number,
  verdict: ScanTrendPoint["verdict"] = "violations",
): ScanTrendPoint {
  return { id, createdAt, verdict, fresh, baselined: 0 };
}

describe("describeScanOutcome", () => {
  it("reports a scan that could not run as such, with its reason", () => {
    const outcome = describeScanOutcome(
      scan({
        verdict: "could-not-run",
        findings: null,
        errorMessage: "hexagen: command not found",
      }),
    );
    expect(outcome.kind).toBe("could-not-run");
    expect(outcome.trustworthy).toBe(false);
    expect(outcome.description).toContain("hexagen: command not found");
  });

  it("still refuses a could-not-run scan when no reason was given", () => {
    const outcome = describeScanOutcome(
      scan({ verdict: "could-not-run", findings: null, errorMessage: "  " }),
    );
    expect(outcome.kind).toBe("could-not-run");
    expect(outcome.trustworthy).toBe(false);
  });

  it("does NOT read a pass verdict with uncollected findings as clean", () => {
    // The defect this whole arc exists to prevent. `collected: false` carries
    // four empty arrays, so a counts-first classifier prints "nothing is
    // failing the gate" for a scan that never looked.
    const outcome = describeScanOutcome(
      scan({
        verdict: "pass",
        findings: {
          collected: false,
          failureReason: "hexagen-lint exited 127",
          fresh: [],
          baselined: [],
          stale: [],
          expired: [],
        },
      }),
    );
    expect(outcome.kind).toBe("unreadable");
    expect(outcome.trustworthy).toBe(false);
    expect(outcome.title).not.toContain("Nothing is failing");
    expect(outcome.description).toContain("hexagen-lint exited 127");
  });

  it("does NOT read a pass verdict with an absent findings field as clean", () => {
    const outcome = describeScanOutcome(
      scan({ verdict: "pass", findings: undefined }),
    );
    expect(outcome.kind).toBe("unreadable");
    expect(outcome.trustworthy).toBe(false);
  });

  it("flags a verdict that disagrees with its own findings list", () => {
    const outcome = describeScanOutcome(
      scan({ verdict: "violations", findings: collected(0) }),
    );
    expect(outcome.kind).toBe("inconsistent");
    expect(outcome.trustworthy).toBe(false);
  });

  it("reports a genuinely clean scan as clean", () => {
    const outcome = describeScanOutcome(
      scan({ verdict: "pass", exitCode: 0, findings: collected(0) }),
    );
    expect(outcome.kind).toBe("clean");
    expect(outcome.trustworthy).toBe(true);
  });

  it("counts fresh findings, and says one in the singular", () => {
    expect(describeScanOutcome(scan({ findings: collected(1) })).title).toBe(
      "1 finding is failing the gate",
    );
    expect(describeScanOutcome(scan({ findings: collected(4) })).title).toBe(
      "4 findings are failing the gate",
    );
  });
});

describe("describeFilesScanned", () => {
  it("separates 'never reported' from 'read nothing'", () => {
    // Both are absences and only one of them is the scan's fault; collapsing
    // them into one dash is how a zero-file scan reads as a clean one.
    expect(describeFilesScanned(null)).toContain("did not report");
    expect(describeFilesScanned(0)).toContain("no files at all");
    expect(describeFilesScanned(1)).toBe("1 file scanned.");
    expect(describeFilesScanned(2481)).toBe("2481 files scanned.");
  });
});

describe("formatScanTimestamp", () => {
  it("formats in UTC and says so", () => {
    // Deterministic by construction -- toLocaleString would differ between the
    // server render and the browser hydration and desync the table's row names.
    expect(formatScanTimestamp(Date.UTC(2026, 7, 20, 14, 2))).toBe(
      "20 Aug 2026, 14:02 UTC",
    );
  });

  it("pads single-digit clock fields", () => {
    expect(formatScanTimestamp(Date.UTC(2026, 0, 3, 4, 5))).toBe(
      "3 Jan 2026, 04:05 UTC",
    );
  });

  it("does not throw on a nonsense timestamp", () => {
    expect(formatScanTimestamp(Number.NaN)).toBe("unknown time");
  });
});

describe("buildRatchetTrend", () => {
  const t0 = Date.UTC(2026, 7, 1, 9, 0);
  const day = 86_400_000;

  it("says nothing at all when there is no history", () => {
    const trend = buildRatchetTrend([]);
    expect(trend.points).toEqual([]);
    expect(trend.summary).toBeNull();
    expect(trend.insufficientLabel).toBeNull();
    expect(trend.emptyLabel).toContain("no ratchet history");
  });

  it("refuses a trend sentence for a single scan and says why", () => {
    const trend = buildRatchetTrend([trendPoint("a", t0, 41)]);
    expect(trend.measuredCount).toBe(1);
    expect(trend.summary).toBeNull();
    expect(trend.insufficientLabel).toContain("41");
    expect(trend.insufficientLabel).toContain("A trend needs two");
  });

  it("plots fresh counts and describes the direction", () => {
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 41),
      trendPoint("b", t0 + day, 20),
      trendPoint("c", t0 + 2 * day, 7),
    ]);
    expect(trend.points.map((p) => p.value)).toEqual([41, 20, 7]);
    expect(trend.measuredCount).toBe(3);
    expect(trend.summary).toBe(
      "Findings failing the gate fell from 41 to 7 across the last 3 scans.",
    );
  });

  it("names a rising ratchet a rise, not a change", () => {
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 7),
      trendPoint("b", t0 + day, 20),
    ]);
    expect(trend.summary).toContain("rose from 7 to 20");
  });

  it("names a flat ratchet flat", () => {
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 7),
      trendPoint("b", t0 + day, 7),
    ]);
    expect(trend.summary).toContain("have stayed at 7");
  });

  it("never plots a could-not-run scan as zero findings", () => {
    // The trend-shaped version of the same false green: the stored row really
    // does carry fresh = 0, because nothing counted it.
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 41),
      trendPoint("b", t0 + day, 0, "could-not-run"),
      trendPoint("c", t0 + 2 * day, 30),
    ]);
    expect(trend.points.map((p) => p.value)).toEqual([41, null, 30]);
    expect(trend.points[1].note).toBe("the scan could not run");
    expect(trend.unmeasuredCount).toBe(1);
    expect(trend.summary).toContain("shown as a gap rather than a zero");
    // And the direction is read between the MEASURED endpoints only.
    expect(trend.summary).toContain("fell from 41 to 30");
  });

  it("pluralises the gap note", () => {
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 41),
      trendPoint("b", t0 + day, 0, "could-not-run"),
      trendPoint("c", t0 + 2 * day, 0, "could-not-run"),
      trendPoint("d", t0 + 3 * day, 30),
    ]);
    expect(trend.summary).toContain("2 scans could not run");
  });

  it("has nothing to draw when every scan could not run", () => {
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 0, "could-not-run"),
      trendPoint("b", t0 + day, 0, "could-not-run"),
    ]);
    expect(trend.measuredCount).toBe(0);
    expect(trend.summary).toBeNull();
    expect(trend.insufficientLabel).toContain("no trend to draw");
  });

  it("preserves the store's order rather than re-sorting it", () => {
    // trend() already returns oldest-first, tie-broken on rowid. A defensive
    // re-sort here would hide a store regression behind a plausible chart.
    const trend = buildRatchetTrend([
      trendPoint("a", t0 + 2 * day, 7),
      trendPoint("b", t0, 41),
    ]);
    expect(trend.points.map((p) => p.id)).toEqual(["a", "b"]);
    expect(trend.summary).toContain("rose from 7 to 41");
  });

  it("counts a pass verdict as a real measurement of zero", () => {
    // A clean scan genuinely measured zero. Only could-not-run is a gap.
    const trend = buildRatchetTrend([
      trendPoint("a", t0, 12),
      trendPoint("b", t0 + day, 0, "pass"),
    ]);
    expect(trend.points.map((p) => p.value)).toEqual([12, 0]);
    expect(trend.summary).toContain("fell from 12 to 0");
  });
});

describe("buildScanReport", () => {
  it("blocks the gate installer on an untrustworthy scan, with a reason", () => {
    const model = buildScanReport({
      scan: scan({ verdict: "could-not-run", findings: null }),
    });
    expect(model.canInstallGate).toBe(false);
    expect(model.gateBlockedReason).toContain("Run it again");
    // No counts either -- four zeroes would be the clean bill of health.
    expect(model.counts).toBeNull();
  });

  // Regression, raised in review on #611. The assertion above passes for the
  // wrong reason: `findings: null` makes summarizeFindingsSource return null
  // on its own, so it never exercised the trustworthy gate. These two do.
  it("shows no counts on the inconsistent arm, where zeroes are real", () => {
    // verdict "violations" with 0 fresh findings. counts here is a genuine
    // object of zeroes, not null -- so before the gate the screen printed
    // four 0 pills immediately under a heading saying the verdict and the
    // findings disagree. Zeroes scan as a clean bill of health.
    const model = buildScanReport({
      scan: scan({ verdict: "violations", findings: collected(0) }),
    });
    expect(model.outcome.kind).toBe("inconsistent");
    expect(model.outcome.trustworthy).toBe(false);
    expect(model.counts).toBeNull();
  });

  it("shows no counts when a could-not-run scan still carries findings", () => {
    // An inconsistent payload: the scan says it never ran, but a findings
    // blob came back anyway. `could-not-run` is classified before the
    // findings are read, so nothing downstream would have suppressed these.
    const model = buildScanReport({
      scan: scan({ verdict: "could-not-run", findings: collected(4) }),
    });
    expect(model.outcome.kind).toBe("could-not-run");
    expect(model.counts).toBeNull();
    expect(model.canInstallGate).toBe(false);
  });

  it("allows the installer on a scan that produced a real answer", () => {
    const model = buildScanReport({ scan: scan() });
    expect(model.canInstallGate).toBe(true);
    expect(model.gateBlockedReason).toBeNull();
    expect(model.counts).toEqual({
      fresh: 3,
      baselined: 0,
      stale: 0,
      expired: 0,
    });
  });

  it("allows the installer on a clean scan", () => {
    const model = buildScanReport({
      scan: scan({ verdict: "pass", exitCode: 0, findings: collected(0) }),
    });
    expect(model.canInstallGate).toBe(true);
    expect(model.outcome.kind).toBe("clean");
  });

  it("renders with no trend at all", () => {
    const model = buildScanReport({ scan: scan() });
    expect(model.trend.points).toEqual([]);
    expect(model.trend.emptyLabel.length).toBeGreaterThan(0);
  });

  it("passes the CLI report through verbatim", () => {
    const markdown = "# Report\n\n- one\n";
    const model = buildScanReport({ scan: scan({ reportMarkdown: markdown }) });
    expect(model.reportMarkdown).toBe(markdown);
  });
});
