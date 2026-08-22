"use client";

import { useCallback, useRef, useState } from "react";
import { downloadBlob } from "@/lib/download-blob";
import type { BrownfieldGateInstallMode } from "../BrownfieldFlow/types";
import {
  GATE_INSTALL_ROUTE_MODE,
  INSTALL_GATE_ENDPOINT,
  gateBundleFileName,
  isInstallableScanId,
} from "./gate-bundle-manifest";

/**
 * The S7 phase machine, mirroring `ExportDialogPhase` in
 * `features/export/ExportDialog.tsx`: the view is a pure function of one string
 * plus its payload, so every panel is renderable in a test without driving a
 * network round trip.
 *
 * `delivered` is TERMINAL BY DESIGN and does nothing on entry. The house rule
 * is that a success/telemetry arm never navigates on the user's behalf, and
 * this is the last screen of the whole brownfield flow, so the panel offers
 * explicit actions (download again · done) and waits.
 */
export type GateInstallPhase = "idle" | "preparing" | "delivered" | "failed";

export interface UseGateInstallOptions {
  /** Correlation id for the scan the gate is being taken away from. */
  scanId: string;
  /**
   * Fired once, after the bytes are actually in the user's hands. The flow's
   * `installGate` action is the caller's to dispatch — this hook has no opinion
   * about the state machine, so a dialog rendered outside the flow still works.
   */
  onDelivered?: (mode: BrownfieldGateInstallMode) => void;
}

export interface GateInstallController {
  mode: BrownfieldGateInstallMode;
  selectMode: (next: BrownfieldGateInstallMode) => void;
  phase: GateInstallPhase;
  /** Finished, user-facing copy for the `failed` panel. Null otherwise. */
  message: string | null;
  /** Name of the file that was saved, for the `delivered` panel. */
  fileName: string | null;
  /** Request the bundle from BF-6.1's route and hand it to the browser. */
  install: () => Promise<void>;
  /** Return a dismissed dialog to a clean `idle` so reopening is not stale. */
  reset: () => void;
}

const GENERIC_FAILURE =
  "The gate bundle could not be built. Try again in a moment.";
const UNREACHABLE_FAILURE =
  "Could not reach the gate service. Check your connection and try again.";
const SAVE_FAILURE =
  "The bundle was built but your browser would not save it. Check whether downloads are blocked for this site.";
const BAD_SCAN_ID =
  "This scan cannot be identified, so the bundle cannot be named. Re-run the scan and try again.";

/**
 * Pull the route's own `error` string out of a JSON error body.
 *
 * The install-gate route answers every rejection with `{ error: string }` (and
 * a `reason` code on the 501), and those strings are already written for a
 * human — the 501 in particular tells the consultant exactly what to do
 * instead. Preferring the server's sentence over a local one keeps the two from
 * drifting; the local constant is only the fallback for a body that is missing
 * or shaped unexpectedly.
 */
function messageFromErrorBody(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string" &&
    (body as { error: string }).error.trim().length > 0
  ) {
    return (body as { error: string }).error;
  }
  return GENERIC_FAILURE;
}

/**
 * Owns the S7 interaction: which delivery mode is picked, and the request that
 * turns it into a file on disk.
 *
 * The bundle is NOT built here. `install()` posts to BF-6.1's
 * `/api/projects/install-gate`, which calls `hexagenGateBundleFiles()` and zips
 * the result — so the gate the user installs is the same one the greenfield
 * generator emits, and this slice cannot fork it.
 */
export function useGateInstall({
  scanId,
  onDelivered,
}: UseGateInstallOptions): GateInstallController {
  const [mode, setMode] = useState<BrownfieldGateInstallMode>("download-zip");
  const [phase, setPhase] = useState<GateInstallPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Guards against a second request from a double click. A ref rather than the
  // `phase` state because `setPhase` is async: two clicks inside one React
  // batch both observe `phase === "idle"` and both fire, which on this route
  // costs the user two saved files and two hits against a 20/minute budget.
  const inFlight = useRef(false);

  const selectMode = useCallback((next: BrownfieldGateInstallMode) => {
    setMode(next);
    // Picking a different delivery route invalidates whatever the last attempt
    // said. Leaving a stale failure under a freshly chosen mode reads as if the
    // new mode had already failed.
    setMessage(null);
    setPhase((current) => (current === "failed" ? "idle" : current));
  }, []);

  const reset = useCallback(() => {
    inFlight.current = false;
    setPhase("idle");
    setMessage(null);
    setFileName(null);
  }, []);

  const install = useCallback(async () => {
    if (inFlight.current) return;

    if (!isInstallableScanId(scanId)) {
      setMessage(BAD_SCAN_ID);
      setPhase("failed");
      return;
    }

    inFlight.current = true;
    setMessage(null);
    setPhase("preparing");

    try {
      const response = await fetch(INSTALL_GATE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          mode: GATE_INSTALL_ROUTE_MODE[mode],
        }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setMessage(messageFromErrorBody(body));
        setPhase("failed");
        return;
      }

      const blob = await response.blob();
      const name = gateBundleFileName(scanId);
      const saved = downloadBlob(blob, name);
      if (!saved.success) {
        setMessage(SAVE_FAILURE);
        setPhase("failed");
        return;
      }

      setFileName(name);
      setPhase("delivered");
      onDelivered?.(mode);
    } catch {
      // A thrown fetch is a transport failure, never an HTTP status — the
      // message says "could not reach", not "was rejected", because those send
      // the user to different places.
      setMessage(UNREACHABLE_FAILURE);
      setPhase("failed");
    } finally {
      inFlight.current = false;
    }
  }, [mode, onDelivered, scanId]);

  return { mode, selectMode, phase, message, fileName, install, reset };
}
