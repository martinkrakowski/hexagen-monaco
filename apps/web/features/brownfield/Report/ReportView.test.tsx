/**
 * S6 presentation.
 *
 * The transforms are covered by `report-summary.test.ts`; what is asserted
 * here is only what the DOM adds — that an unread scan renders no counts at
 * all (rather than four zeroes), that the trend is reachable as data and not
 * only as pixels, and that the installer is described when it is disabled.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type {
  ProjectScanResponse,
  ScanFindings,
} from "@/lib/project-scan/types";
import type { ScanTrendPoint } from "../../../lib/platform/scan-records-store";
import { ReportFooterActions, ReportView } from "./ReportView";
import { buildScanReport } from "./report-summary";

// jest-dom is a dependency but apps/web/vitest.setup.ts never imports it, so
// toBeInTheDocument / toHaveAttribute are UNREGISTERED. Assertions below use
// toBeTruthy() / toBeNull() / getAttribute() instead.

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

const T0 = Date.UTC(2026, 7, 18, 9, 0);
const DAY = 86_400_000;

const TREND: ScanTrendPoint[] = [
  { id: "s1", createdAt: T0, verdict: "violations", fresh: 41, baselined: 0 },
  {
    id: "s2",
    createdAt: T0 + DAY,
    verdict: "could-not-run",
    fresh: 0,
    baselined: 0,
  },
  {
    id: "s3",
    createdAt: T0 + 2 * DAY,
    verdict: "violations",
    fresh: 7,
    baselined: 27,
  },
];

describe("ReportView", () => {
  it("names the outcome in the heading and counts the buckets", () => {
    render(
      <ReportView model={buildScanReport({ scan: scan(), trend: TREND })} />,
    );
    expect(
      screen.getByRole("heading", { name: "3 findings are failing the gate" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Finding counts" })).toBeTruthy();
  });

  it("renders NO counts at all for a scan whose findings were never read", () => {
    // Four zeroes is a clean bill of health for a scan that never looked, so
    // the pills are absent rather than empty.
    render(
      <ReportView
        model={buildScanReport({
          scan: scan({
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
        })}
      />,
    );
    expect(screen.queryByRole("list", { name: "Finding counts" })).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "The scan could not read the findings",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/hexagen-lint exited 127/)).toBeTruthy();
  });

  it("states why the gate cannot be installed when the scan could not run", () => {
    render(
      <ReportView
        model={buildScanReport({
          scan: scan({
            verdict: "could-not-run",
            findings: null,
            errorMessage: "hexagen: command not found",
          }),
        })}
      />,
    );
    expect(
      screen.getByText(/Run it again before installing anything/),
    ).toBeTruthy();
  });

  it("exposes the trend as a table, not only as a drawing", () => {
    render(
      <ReportView model={buildScanReport({ scan: scan(), trend: TREND })} />,
    );

    const table = screen.getByRole("table", {
      name: "Findings failing the gate, by scan, oldest first",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3
    expect(
      within(table).getByRole("rowheader", { name: "18 Aug 2026, 09:00 UTC" }),
    ).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: "Failing the gate" }),
    ).toBeTruthy();
  });

  it("says a scan could not run instead of plotting it as zero", () => {
    render(
      <ReportView model={buildScanReport({ scan: scan(), trend: TREND })} />,
    );
    const table = screen.getByRole("table");
    const gapRow = within(table).getByRole("rowheader", {
      name: "19 Aug 2026, 09:00 UTC",
    }).parentElement as HTMLElement;
    expect(gapRow.textContent).toContain("the scan could not run");
    expect(within(gapRow).queryByText("0")).toBeNull();
  });

  it("keeps the chart out of the accessibility tree", () => {
    render(
      <ReportView model={buildScanReport({ scan: scan(), trend: TREND })} />,
    );
    const svg = screen.getByTestId("ratchet-sparkline");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws no chart from a single scan and says why in words", () => {
    render(
      <ReportView
        model={buildScanReport({ scan: scan(), trend: [TREND[0]] })}
      />,
    );
    expect(screen.queryByTestId("ratchet-sparkline")).toBeNull();
    expect(screen.getByText(/A trend needs two/)).toBeTruthy();
    // The one measurement is still shown.
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("says there is no history rather than drawing an empty chart", () => {
    render(<ReportView model={buildScanReport({ scan: scan(), trend: [] })} />);
    expect(screen.queryByTestId("ratchet-sparkline")).toBeNull();
    expect(screen.getByText(/no ratchet history to show/)).toBeTruthy();
  });

  it("shows the CLI's own report verbatim, behind a disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ReportView
        model={buildScanReport({
          scan: scan({
            reportMarkdown: "# Report\n\n- cross-package-import: 3",
          }),
          trend: TREND,
        })}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /the scan's own report/i,
    });
    await user.click(trigger);
    expect(screen.getByText(/- cross-package-import: 3/)).toBeTruthy();
  });

  it("omits the disclosure entirely when the scan sent no report", () => {
    render(
      <ReportView model={buildScanReport({ scan: scan(), trend: TREND })} />,
    );
    expect(
      screen.queryByRole("button", { name: /the scan's own report/i }),
    ).toBeNull();
  });
});

describe("ReportFooterActions", () => {
  it("raises the install intent and never navigates", async () => {
    const user = userEvent.setup();
    const onInstallGate = vi.fn();
    const onBack = vi.fn();
    render(
      <ReportFooterActions
        canInstallGate
        blockedReason={null}
        onBack={onBack}
        onInstallGate={onInstallGate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Install the gate" }));
    expect(onInstallGate).toHaveBeenCalledTimes(1);
  });

  it("describes the disabled button rather than leaving it silently inert", () => {
    render(
      <ReportFooterActions
        canInstallGate={false}
        blockedReason="The gate is installed from what this scan found, and this scan did not produce a usable result."
        onBack={() => {}}
        onInstallGate={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Install the gate" });
    expect(button.getAttribute("disabled")).not.toBeNull();

    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const note = document.getElementById(describedBy as string);
    expect(note?.textContent).toContain("did not produce a usable result");
  });
});
