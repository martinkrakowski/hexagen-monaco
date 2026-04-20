"use client";

import { useCallback, useState } from "react";

import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import { downloadBlob } from "@/lib/download-blob";
import { postJson, postForBlob } from "@/lib/fetch-json";
import type { ExportDialogSubmitPayload } from "@/components/export/ExportDialog";

/**
 * Discriminated state machine for the project export flow.
 *
 * Replaces four independent useState pieces (dialogOpen, exporting,
 * error, statusMessage) with a single variant at a time. Illegal
 * combinations (e.g. `exporting && error`) are no longer representable.
 */
export type ExportState =
  | { kind: "idle" }
  | { kind: "dialog-open" }
  | { kind: "exporting"; destination: "zip" | "github" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface GithubExportResponse {
  destinationUrl?: string;
}

export interface UseProjectExportReturn {
  state: ExportState;
  canExport: boolean;
  isAuthenticated: boolean;

  /** Trigger a ZIP export; fires download on success. */
  exportZip: () => Promise<void>;
  /** Open the GitHub export dialog (after auth guard). */
  requestGithubExport: () => Promise<void>;
  /** Submit the GitHub dialog form. */
  submitGithubExport: (payload: ExportDialogSubmitPayload) => Promise<void>;

  /** Close the GitHub dialog without submitting. */
  closeDialog: () => void;
  /** Dismiss the status/error strip (return to idle). */
  dismissStatus: () => void;
}

/**
 * Owns the export state machine and HTTP calls. UI components
 * (ProjectMenu, Header, ExportStatusStrip) observe `state` and call
 * the returned actions — no fetch or DOM manipulation at the call site.
 */
export function useProjectExport(): UseProjectExportReturn {
  const { activeWorkspace } = useActiveWorkspace();
  const { isAuthenticated, signIn } = useExternalIntegration();
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  const canExport = activeWorkspace !== null;

  const exportZip = useCallback(async () => {
    if (!activeWorkspace) return;
    setState({ kind: "exporting", destination: "zip" });

    const result = await postForBlob("/api/export/zip", {
      projectId: activeWorkspace.projectId,
      wizardData: activeWorkspace.wizardData,
    });

    if (result.kind !== "success") {
      setState({ kind: "error", message: result.message });
      return;
    }

    const filename = `${activeWorkspace.name || activeWorkspace.projectId}.zip`;
    const download = downloadBlob(result.data, filename);
    if (!download.success) {
      setState({ kind: "error", message: download.error.message });
      return;
    }

    setState({ kind: "success", message: "ZIP downloaded" });
  }, [activeWorkspace]);

  const requestGithubExport = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    if (!activeWorkspace) return;
    setState({ kind: "dialog-open" });
  }, [isAuthenticated, signIn, activeWorkspace]);

  const submitGithubExport = useCallback(
    async ({ repoName, isPrivate }: ExportDialogSubmitPayload) => {
      if (!activeWorkspace) return;
      setState({ kind: "exporting", destination: "github" });

      const result = await postJson<GithubExportResponse>(
        "/api/export/github",
        {
          projectId: activeWorkspace.projectId,
          repoName,
          isPrivate,
          wizardData: activeWorkspace.wizardData,
        },
      );

      if (result.kind !== "success") {
        setState({ kind: "error", message: result.message });
        return;
      }

      const destinationUrl = result.data.destinationUrl;
      if (destinationUrl) {
        window.open(destinationUrl, "_blank", "noopener,noreferrer");
        setState({ kind: "success", message: `Pushed to ${destinationUrl}` });
      } else {
        setState({ kind: "success", message: "Pushed to GitHub" });
      }
    },
    [activeWorkspace],
  );

  const closeDialog = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  const dismissStatus = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  return {
    state,
    canExport,
    isAuthenticated,
    exportZip,
    requestGithubExport,
    submitGithubExport,
    closeDialog,
    dismissStatus,
  };
}
