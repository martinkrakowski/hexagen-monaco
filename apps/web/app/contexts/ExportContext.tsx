"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import { downloadBlob } from "@/lib/download-blob";
import { postJson, postForBlob } from "@/lib/fetch-json";
import { getSavedProjectsPersistence, getLogger } from "@/lib/wire.client";
import type { ExportDialogSubmitPayload } from "../../features/export/ExportDialog";

import {
  isGithubExportActive,
  type ExportState,
  type GithubLinkData,
} from "./export-state";

// Re-export the pure state types/selector so existing consumers keep importing
// them from "@/contexts/ExportContext".
export {
  isGithubExportActive,
  type ExportState,
  type ExportDestination,
  type GithubLinkData,
} from "./export-state";

interface GithubExportResponse {
  destinationUrl?: string;
  githubLink?: GithubLinkData;
}

export interface ProjectExportContextValue {
  state: ExportState;
  canExport: boolean;
  isAuthenticated: boolean;

  /** Trigger a ZIP export; fires download on success. */
  exportZip: () => Promise<void>;
  /** Open the GitHub export dialog (after auth guard) — the entry path. */
  requestGithubExport: () => Promise<void>;
  /**
   * Show the dialog form without the auth guard — for "Back to form" after an
   * error, where the user already authenticated and a lapsed session shouldn't
   * bounce them to OAuth.
   */
  showGithubDialog: () => void;
  /** Submit the GitHub dialog form. */
  submitGithubExport: (payload: ExportDialogSubmitPayload) => Promise<void>;
  /** Re-run the last GitHub publish (after an error) without re-entering the form. */
  retryGithubExport: () => Promise<void>;

  /** Close the GitHub dialog without submitting. */
  closeDialog: () => void;
  /** Dismiss the status/error strip (return to idle). */
  dismissStatus: () => void;
}

const ProjectExportContext = createContext<ProjectExportContextValue | null>(
  null,
);

/**
 * Lifts the project export state machine so every consumer in the
 * workspace (Header menu, SummaryStep, future toolbar shortcuts) sees
 * the same `state`. Before this context, ProjectMenu and SummaryStep
 * each owned independent useState instances — triggering a ZIP export
 * from the summary step didn't reflect in the header status strip and
 * vice versa.
 */
export function ExportProvider({ children }: { children: ReactNode }) {
  const { activeWorkspace } = useActiveWorkspace();
  // Destructure only the export-relevant fields so that isDirty/lastModifiedAt
  // changes (triggered on every editor keystroke) do not invalidate the
  // callback identities that feed into the context value.
  const activeProjectId = activeWorkspace?.projectId;
  const activeProjectName = activeWorkspace?.name;
  const activeWizardData = activeWorkspace?.wizardData;
  const { isAuthenticated, signIn } = useExternalIntegration();
  const [state, setState] = useState<ExportState>({ kind: "idle" });
  // Last submitted GitHub payload, kept in a ref (not state) so error → Retry
  // can re-run it without re-rendering or threading it through every variant.
  // Set on submit; cleared when the flow returns to idle.
  const lastGithubPayload = useRef<ExportDialogSubmitPayload | null>(null);

  const canExport = activeWorkspace !== null;

  const exportZip = useCallback(async () => {
    if (!activeProjectId) return;
    setState({ kind: "exporting", destination: "zip" });

    const result = await postForBlob("/api/export/zip", {
      projectId: activeProjectId,
      wizardData: activeWizardData,
    });

    if (result.kind !== "success") {
      setState({ kind: "error", destination: "zip", message: result.message });
      return;
    }

    const filename = `${activeProjectName || activeProjectId}.zip`;
    const download = downloadBlob(result.data, filename);
    if (!download.success) {
      setState({
        kind: "error",
        destination: "zip",
        message: download.error.message,
      });
      return;
    }

    setState({
      kind: "success",
      destination: "zip",
      message: "ZIP downloaded",
    });
  }, [activeProjectId, activeProjectName, activeWizardData]);

  const requestGithubExport = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    if (!activeProjectId) return;
    setState({ kind: "dialog-open" });
  }, [isAuthenticated, signIn, activeProjectId]);

  // Return to the editable form (e.g. after an error) without re-running the
  // auth guard — the user already authenticated to get here.
  const showGithubDialog = useCallback(() => {
    setState({ kind: "dialog-open" });
  }, []);

  const submitGithubExport = useCallback(
    async ({ repoName, isPrivate }: ExportDialogSubmitPayload) => {
      if (!activeProjectId) return;
      // Remember the payload so error → Retry can re-run it as-is.
      lastGithubPayload.current = { repoName, isPrivate };
      setState({ kind: "exporting", destination: "github" });

      const result = await postJson<GithubExportResponse>(
        "/api/export/github",
        {
          projectId: activeProjectId,
          repoName,
          isPrivate,
          wizardData: activeWizardData,
        },
      );

      if (result.kind !== "success") {
        setState({
          kind: "error",
          destination: "github",
          message: result.message,
        });
        return;
      }

      const destinationUrl = result.data.destinationUrl;
      const githubLink = result.data.githubLink;
      if (githubLink) {
        // Persist link to the SavedProject (client-side IDB). Server route never
        // sees/persists SavedProject; token stays server-only. Awaited so a
        // failed write surfaces (rather than silently dropping the link); the
        // GitHub push already succeeded, so we still report success either way.
        try {
          const persistence = getSavedProjectsPersistence();
          const loadRes = await persistence.loadProjects();
          if (loadRes.success) {
            const updated = loadRes.value.map((p) =>
              p.id === activeProjectId
                ? { ...p, githubLink, updatedAt: Date.now() }
                : p,
            );
            const saveRes = await persistence.saveProjects(updated);
            if (!saveRes.success) {
              getLogger().warn(
                "Failed to persist GitHub link to saved project",
              );
            }
          }
        } catch (e) {
          getLogger().errorWithException(
            e,
            "Failed to persist GitHub link to saved project",
          );
        }
      }
      // No eager window.open — the success panel's "Open repository" button is
      // the sole navigation affordance. Carry the structured link for the dialog.
      setState({
        kind: "success",
        destination: "github",
        message: githubLink
          ? `Pushed to ${githubLink.owner}/${githubLink.repo}`
          : "Pushed to GitHub",
        destinationUrl,
        githubLink,
      });
    },
    [activeProjectId, activeWizardData],
  );

  const retryGithubExport = useCallback(async () => {
    const payload = lastGithubPayload.current;
    if (!payload) return;
    await submitGithubExport(payload);
  }, [submitGithubExport]);

  const closeDialog = useCallback(() => {
    lastGithubPayload.current = null;
    setState({ kind: "idle" });
  }, []);

  const dismissStatus = useCallback(() => {
    lastGithubPayload.current = null;
    setState({ kind: "idle" });
  }, []);

  // Memoized so consumers only re-render when the state machine or
  // a handler reference actually changes.
  const value = useMemo<ProjectExportContextValue>(
    () => ({
      state,
      canExport,
      isAuthenticated,
      exportZip,
      requestGithubExport,
      showGithubDialog,
      submitGithubExport,
      retryGithubExport,
      closeDialog,
      dismissStatus,
    }),
    [
      state,
      canExport,
      isAuthenticated,
      exportZip,
      requestGithubExport,
      showGithubDialog,
      submitGithubExport,
      retryGithubExport,
      closeDialog,
      dismissStatus,
    ],
  );

  return (
    <ProjectExportContext.Provider value={value}>
      {children}
    </ProjectExportContext.Provider>
  );
}

export function useProjectExport(): ProjectExportContextValue {
  const ctx = useContext(ProjectExportContext);
  if (!ctx) {
    throw new Error("useProjectExport must be used within ExportProvider");
  }
  return ctx;
}
