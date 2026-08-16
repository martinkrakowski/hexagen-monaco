"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { downloadBlob } from "@/lib/download-blob";
import { postForBlob } from "@/lib/fetch-json";
import { withFormStateDefaults } from "@/lib/form-state-defaults";
import { resolveImportedManifestPayload } from "@/lib/imported-manifest";

import type { ZipExportState } from "./export-state";
import { useProjectExportRecord } from "./ProjectExportRecordContext";

export interface ZipExportContextValue {
  state: ZipExportState;
  /** False when there is no active project to export. */
  canExport: boolean;
  /** Trigger a ZIP export; fires the download on success. */
  exportZip: () => Promise<void>;
  /** Dismiss the status/error strip (return to idle). */
  dismissStatus: () => void;
}

const ZipExportContext = createContext<ZipExportContextValue | null>(null);

/**
 * The ZIP download flow, on its own context (GOD-004).
 *
 * The point of the separation is the subscription, not the file count: while
 * ZIP and GitHub shared one context value, opening the GitHub dialog — a
 * surface the ZIP path never renders — re-rendered every ZIP consumer, and the
 * status strip had to filter GitHub states back out with a selector to avoid
 * double-reporting the publish. Neither concern reaches this module now.
 */
export function ZipExportProvider({
  projectId,
  projectName,
  wizardData,
  canExport,
  children,
}: {
  projectId: string | undefined;
  projectName: string | undefined;
  /** The live workspace snapshot; primary over the saved record's formState. */
  wizardData: Record<string, unknown> | undefined;
  /** Whether a workspace is active at all (the export menu's enablement). */
  canExport: boolean;
  children: ReactNode;
}) {
  const { savedFormState, savedManifestYaml } = useProjectExportRecord();
  const [state, setState] = useState<ZipExportState>({ kind: "idle" });

  const exportZip = useCallback(async () => {
    if (!projectId) return;
    // Import round-trip integrity (Item 1.3), decided by the one shared
    // resolver (REA-005): for an IMPORTED project the payload carries the
    // parsed saved manifest so the route's `body.manifest ??
    // wizardToManifest(body.wizardData)` fallback never runs the degraded
    // projection, and a corrupt saved manifest FAILS CLOSED with a blocking
    // error rather than silently falling back to it.
    const manifestPayload = resolveImportedManifestPayload(
      wizardData ?? savedFormState,
      savedManifestYaml,
    );
    if (!manifestPayload.ok) {
      setState({ kind: "error", message: manifestPayload.message });
      return;
    }
    setState({ kind: "exporting" });

    const result = await postForBlob("/api/export/zip", {
      projectId,
      // Live workspace state primary (matches the code view); IDB formState as a
      // fallback; normalized so a legacy snapshot still carries addOnsAnswers.
      // wizardData is still sent alongside `manifest` for imported projects:
      // the route reads addOnsAnswers from it.
      wizardData: withFormStateDefaults(wizardData ?? savedFormState),
      ...manifestPayload.extra,
    });

    if (result.kind !== "success") {
      setState({ kind: "error", message: result.message });
      return;
    }

    const filename = `${projectName || projectId}.zip`;
    const download = downloadBlob(result.data, filename);
    if (!download.success) {
      setState({ kind: "error", message: download.error.message });
      return;
    }

    setState({
      kind: "success",
      message: "ZIP downloaded",
      notices: result.notices,
    });
  }, [projectId, projectName, wizardData, savedFormState, savedManifestYaml]);

  const dismissStatus = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  const value = useMemo<ZipExportContextValue>(
    () => ({ state, canExport, exportZip, dismissStatus }),
    [state, canExport, exportZip, dismissStatus],
  );

  return (
    <ZipExportContext.Provider value={value}>
      {children}
    </ZipExportContext.Provider>
  );
}

export function useZipExport(): ZipExportContextValue {
  const ctx = useContext(ZipExportContext);
  if (!ctx) {
    throw new Error("useZipExport must be used within ExportProvider");
  }
  return ctx;
}
