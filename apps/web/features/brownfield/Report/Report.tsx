"use client";

import type { ProjectScanResponse } from "@/lib/project-scan/types";
import type { ScanTrendPoint } from "../../../lib/platform/scan-records-store";
import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";
import { GateInstall } from "../GateInstall/GateInstall";
import { BrownfieldScreenFrame } from "../views/BrownfieldScreenFrame";
import { ReportFooterActions, ReportView } from "./ReportView";
import { useScanReport } from "./useScanReport";

/**
 * S6 container (F-20, BF-7.2) — the report, plus the S7 installer it opens.
 *
 * ## It never navigates, and the machine is what guarantees it
 *
 * There is no `router.push` here and no effect that moves the user. `report` is
 * terminal-WITH-ACTIONS: the only event that leaves it is an explicit
 * `INSTALL_GATE`, raised by `useScanReport.openGate` on the click that opens the
 * dialog. That is the standing no-auto-navigate-past-telemetry rule, expressed
 * structurally rather than as a convention every caller must remember. Leaving
 * the flow entirely is `onExit`, which is also a button.
 *
 * ## Why the host renders this for `gate_install` as well as `report`
 *
 * `gate_install` is the state you are IN while the dialog is up — the dialog is
 * a layer over this screen, not a page of its own (feature plan §1.3: "S7
 * (dialog, not a page)"). `gate_install` also has NO outgoing edge, so once the
 * dialog is dismissed the flow legitimately stays there while this screen keeps
 * rendering. A host that switched on `report` alone would blank the page the
 * moment the user opened the installer.
 *
 * ## Why `trend` is optional and usually absent
 *
 * `ScanTrendPoint` comes from `lib/platform/scan-records-store`, which is a
 * better-sqlite3 store with no route in front of it — nothing client-side can
 * read it today. `buildRatchetTrend([])` handles that honestly (it renders an
 * "not enough history" label rather than a flat line), so the screen is correct
 * with no trend at all, which is also the true state of a first scan.
 */
export interface ReportProps {
  /** The scan, straight off the wire and UNNORMALISED. */
  scan: ProjectScanResponse;
  /** BF-7.1's `trend()` output, oldest first. Absent until a route exposes it. */
  trend?: readonly ScanTrendPoint[];
  /** Correlation id — names the downloaded bundle. See `deriveScanId`. */
  scanId: string;
  /** Raised on the click that opens the installer, so the flow enters S7. */
  onInstallGate: () => void;
  /** Fired once the bundle is actually in the user's hands. Never a navigation. */
  onGateDelivered?: (mode: BrownfieldGateInstallMode) => void;
  /** Leaves the flow. A button, never a success arm. */
  onExit: () => void;
}

export function Report({
  scan,
  trend,
  scanId,
  onInstallGate,
  onGateDelivered,
  onExit,
}: ReportProps) {
  const report = useScanReport({ scan, trend, onInstallGate });
  const { model } = report;

  /**
   * The slice's own footer component. Its `onBack` is wired to `onExit`, and
   * that is not a shortcut: `backTarget("report")` is `null`, so the machine
   * defines Back on this screen as a no-op. The only honest backward move from a
   * point-in-time artifact is out of the flow, so the button does that rather
   * than sitting there doing nothing.
   */
  const footer = (
    <ReportFooterActions
      canInstallGate={model.canInstallGate}
      blockedReason={model.gateBlockedReason}
      onBack={onExit}
      onInstallGate={report.openGate}
    />
  );

  return (
    <BrownfieldScreenFrame measure="wide" footer={footer}>
      <ReportView model={model} />
      <GateInstall
        open={report.gateOpen}
        scanId={scanId}
        onClose={report.closeGate}
        onDelivered={onGateDelivered}
      />
    </BrownfieldScreenFrame>
  );
}
