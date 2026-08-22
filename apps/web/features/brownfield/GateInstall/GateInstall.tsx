"use client";

import { useEffect } from "react";
import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";
import { GateInstallDialog } from "./GateInstallDialog";
import { useGateInstall } from "./useGateInstall";

/**
 * S7 container — the only export a host screen needs.
 *
 * Wires `useGateInstall` (which posts to BF-6.1's `/api/projects/install-gate`)
 * to the presentational `GateInstallDialog`. Nothing else in this slice knows
 * about `fetch`, and the dialog knows about neither `fetch` nor the flow.
 *
 * The host (S6, owned by a later packet) renders this alongside its report and
 * flips `open` from its "Install the gate" button — the same click that
 * dispatches the flow's `INSTALL_GATE` event. This component deliberately does
 * NOT dispatch that itself: `gate_install` is the state you are in while the
 * dialog is up, so entering it is the opener's business, not the dialog's.
 */
export interface GateInstallProps {
  open: boolean;
  /** Correlation id for the scan; also names the downloaded file. */
  scanId: string;
  onClose: () => void;
  /**
   * Fired once the bytes are actually with the user — the right moment to
   * record "gate taken away" against the flow or the draft. Never a navigation
   * trigger: this is a success arm, and success arms do not route.
   */
  onDelivered?: (mode: BrownfieldGateInstallMode) => void;
}

export function GateInstall({
  open,
  scanId,
  onClose,
  onDelivered,
}: GateInstallProps) {
  const gate = useGateInstall({ scanId, onDelivered });
  const { reset } = gate;

  // Reopening must not show the previous attempt's outcome. Reset on the CLOSE
  // edge rather than the open edge so the delivered/failed panel survives for as
  // long as the dialog is actually on screen.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  return (
    <GateInstallDialog
      open={open}
      mode={gate.mode}
      onSelectMode={gate.selectMode}
      phase={gate.phase}
      message={gate.message}
      fileName={gate.fileName}
      onInstall={() => {
        // The promise is intentionally not awaited here: every outcome is
        // already reflected in `phase`, and returning a floating promise from a
        // DOM handler is what `no-misused-promises` exists to stop.
        void gate.install();
      }}
      onClose={onClose}
    />
  );
}
