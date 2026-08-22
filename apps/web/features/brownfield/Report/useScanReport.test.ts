/**
 * S6 state behaviour.
 *
 * The transforms are covered by `report-summary.test.ts`; what is asserted
 * here is only what the hook adds — that the gate cannot be opened from a scan
 * that produced nothing, and that opening it tells the flow machine on the
 * same tick it tells the dialog.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type {
  ProjectScanResponse,
  ScanFindings,
} from "@/lib/project-scan/types";
import { useScanReport } from "./useScanReport";

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

describe("useScanReport", () => {
  it("starts with the installer closed", () => {
    const { result } = renderHook(() => useScanReport({ scan: scan() }));
    expect(result.current.gateOpen).toBe(false);
  });

  it("opens the installer and tells the flow on the same act", () => {
    const onInstallGate = vi.fn();
    const { result } = renderHook(() =>
      useScanReport({ scan: scan(), onInstallGate }),
    );

    act(() => result.current.openGate());

    expect(result.current.gateOpen).toBe(true);
    expect(onInstallGate).toHaveBeenCalledTimes(1);
  });

  it("refuses to open the installer for a scan that could not run", () => {
    // Re-checked in the hook rather than trusted to a disabled button: a
    // keyboard Enter on a stray form must not be able to install a gate whose
    // baseline asserts a state nobody measured.
    const onInstallGate = vi.fn();
    const { result } = renderHook(() =>
      useScanReport({
        scan: scan({ verdict: "could-not-run", findings: null }),
        onInstallGate,
      }),
    );

    act(() => result.current.openGate());

    expect(result.current.gateOpen).toBe(false);
    expect(onInstallGate).not.toHaveBeenCalled();
  });

  it("refuses to open the installer when the findings were never read", () => {
    const onInstallGate = vi.fn();
    const { result } = renderHook(() =>
      useScanReport({
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
        onInstallGate,
      }),
    );

    act(() => result.current.openGate());

    expect(result.current.gateOpen).toBe(false);
    expect(onInstallGate).not.toHaveBeenCalled();
  });

  it("closes without raising anything", () => {
    const onInstallGate = vi.fn();
    const { result } = renderHook(() =>
      useScanReport({ scan: scan(), onInstallGate }),
    );

    act(() => result.current.openGate());
    act(() => result.current.closeGate());

    expect(result.current.gateOpen).toBe(false);
    expect(onInstallGate).toHaveBeenCalledTimes(1);
  });

  it("survives a caller passing a fresh scan object on every render", () => {
    // The render-loop hazard useFindingsReview hit: an inline literal is a new
    // object each render. This hook holds no derived state, so a recompute is
    // the whole cost -- asserted so a later refactor that adds a reset here
    // cannot reintroduce "Too many re-renders" unnoticed.
    const { result, rerender } = renderHook(() =>
      useScanReport({ scan: scan(), trend: [] }),
    );
    rerender();
    rerender();
    expect(result.current.model.outcome.kind).toBe("violations");
  });

  it("builds the model from the scan it was given", () => {
    const { result } = renderHook(() =>
      useScanReport({
        scan: scan({ findings: collected(0), verdict: "pass" }),
      }),
    );
    expect(result.current.model.outcome.kind).toBe("clean");
    expect(result.current.model.canInstallGate).toBe(true);
  });
});
