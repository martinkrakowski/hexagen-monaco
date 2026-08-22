"use client";

import { useCallback, useMemo, useState } from "react";

import type { ProjectScanResponse } from "@/lib/project-scan/types";
import type { ScanTrendPoint } from "../../../lib/platform/scan-records-store";
import { buildScanReport, type ScanReportModel } from "./report-summary";

/**
 * S6 state (F-20, BF-7.2) — the only stateful module in this packet.
 *
 * It owns exactly one thing React has to hold: whether the S7 install dialog
 * is open. Everything else is a memoised call into `report-summary.ts`. No
 * fetch, no router, no storage. In particular there is NO `router.push`
 * anywhere in this packet: `report` is a terminal-with-actions state, and the
 * standing no-auto-navigate-past-telemetry rule means the user leaves this
 * screen by pressing something, never because a success arm moved them on.
 *
 * ## Why the dialog's open flag lives here and not in `GateInstall`
 *
 * `GateInstall` (BF-6.2) takes `open` as a prop and says so in its own
 * docblock: `gate_install` is the flow state you are IN while the dialog is
 * up, so entering it is the opener's business. This hook is the opener. It
 * raises `onInstallGate` on the same tick it opens, so the flow machine and
 * the dialog cannot disagree about which state the user is in.
 *
 * `openGate` re-checks `canInstallGate` rather than trusting the caller to
 * have disabled the button — the same defence `useFindingsReview.ratify` uses,
 * and for the same reason. A gate installed from a scan that could not run
 * writes a baseline asserting a state nobody measured, and a keyboard Enter on
 * a stray form must not be able to do that.
 *
 * ## How the page composes this packet
 *
 * ```tsx
 * const report = useScanReport({
 *   scan,
 *   trend,
 *   onInstallGate: () => dispatch({ type: "INSTALL_GATE" }),
 * });
 *
 * <ProjectsShellWithFreeTier
 *   title="Import an existing codebase"
 *   footer={
 *     <ReportFooterActions
 *       canInstallGate={report.model.canInstallGate}
 *       blockedReason={report.model.gateBlockedReason}
 *       onBack={() => dispatch({ type: "GO_BACK" })}
 *       onInstallGate={report.openGate}
 *     />
 *   }
 * >
 *   <ReportView model={report.model} />
 *   <GateInstall
 *     open={report.gateOpen}
 *     scanId={scanId}
 *     onClose={report.closeGate}
 *   />
 * </ProjectsShellWithFreeTier>
 * ```
 */

export interface UseScanReportOptions {
  /** The scan response, straight off the wire and UNNORMALISED. */
  scan: ProjectScanResponse;
  /**
   * BF-7.1's `trend()` output for this repo, oldest first.
   *
   * Optional because the report must render before any history exists — the
   * first scan of a repo has a trend of exactly one row, and a screen that
   * required two would be unreachable on the run that matters most.
   */
  trend?: readonly ScanTrendPoint[];
  /**
   * Raised when the user opens the installer, so the flow can enter
   * `gate_install`. Never called when the scan is untrustworthy.
   */
  onInstallGate?: () => void;
}

export interface UseScanReportResult {
  model: ScanReportModel;
  /** Whether the S7 dialog is up. Feed straight to `GateInstall`'s `open`. */
  gateOpen: boolean;
  /** No-op while `model.canInstallGate` is false. */
  openGate: () => void;
  closeGate: () => void;
}

export function useScanReport({
  scan,
  trend,
  onInstallGate,
}: UseScanReportOptions): UseScanReportResult {
  // Keyed on the two inputs' identities. Unlike S5 there is no user-editable
  // state to preserve across a re-fetch, so a fresh object from the caller
  // costs a recompute and nothing else -- no reset, no lost decisions, and
  // none of the render-loop hazard that made `useFindingsReview` key on a
  // content signature instead.
  const model = useMemo(() => buildScanReport({ scan, trend }), [scan, trend]);

  const [gateOpen, setGateOpen] = useState(false);

  const openGate = useCallback(() => {
    if (!model.canInstallGate) return;
    setGateOpen(true);
    onInstallGate?.();
  }, [model.canInstallGate, onInstallGate]);

  const closeGate = useCallback(() => {
    setGateOpen(false);
  }, []);

  return { model, gateOpen, openGate, closeGate };
}
