"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { GitHubPublishPrefs, PublishMode } from "@hexagen/shared";

import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import { downloadBlob } from "@/lib/download-blob";
import { postJson, postForBlob } from "@/lib/fetch-json";
import {
  getSavedProjectsPersistence,
  getEditorWorkspacePersistence,
  getLogger,
} from "@/lib/wire.client";
import type { ExportDialogSubmitPayload } from "../../features/export/ExportDialog";
import type { PublishSettingsSubmitPayload } from "../../features/export/PublishSettingsDialog";

import { type ExportState, type GithubLinkData } from "./export-state";
import { decidePublishAction, defaultPublishMessage } from "./publish-settings";

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

interface PushGithubResponse {
  success: boolean;
  commitSha: string;
  commitUrl: string;
}

/** Arguments for a scaffold publish (create when `owner` absent, reuse when present). */
interface ScaffoldPublishArgs {
  owner?: string;
  repoName: string;
  isPrivate: boolean;
  commitMessage?: string;
}

/** The last GitHub operation, replayed by `retryGithubExport` after an error. */
type LastOperation =
  | { kind: "scaffold"; args: ScaffoldPublishArgs }
  | { kind: "editor"; message: string };

/**
 * Load the editor's edited files from IDB for the active project. The editor
 * session is keyed on the project id (see `useEditorSession`), so the publish
 * flow can resolve the current file set without threading reactive editor
 * state through the provider. Best-effort: returns {} on miss/error.
 */
async function loadEditorFiles(
  projectId: string,
): Promise<Record<string, string>> {
  const persistence = getEditorWorkspacePersistence();
  const res = await persistence.loadWorkspace(projectId);
  if (!res.success || !res.value) return {};
  const files: Record<string, string> = {};
  for (const [fileId, entry] of Object.entries(res.value.files)) {
    if (entry && typeof entry.content === "string") {
      files[fileId] = entry.content;
    }
  }
  return files;
}

export interface ProjectExportContextValue {
  state: ExportState;
  canExport: boolean;
  isAuthenticated: boolean;
  /** The connected repo (owner/repo) for the active project, or null. */
  connectedRepo: { owner: string; repo: string } | null;

  /** Trigger a ZIP export; fires download on success. */
  exportZip: () => Promise<void>;
  /**
   * Entry path for the GitHub button. Not linked → create dialog. Linked with a
   * remembered preference → run it directly. Linked without one → settings modal.
   */
  requestGithubExport: () => Promise<void>;
  /**
   * Show the create-dialog form without the auth guard — for "Back to form"
   * after an error, where the user already authenticated and a lapsed session
   * shouldn't bounce them to OAuth.
   */
  showGithubDialog: () => void;
  /**
   * Open the publish-settings modal directly (the gear) — even when a choice is
   * remembered — so the user can change or clear the preference.
   */
  openPublishSettings: () => Promise<void>;
  /** Submit the create-repo dialog form (first publish / "publish to a new repo"). */
  submitGithubExport: (payload: ExportDialogSubmitPayload) => Promise<void>;
  /** Submit the publish-settings modal (mode + commit message + remember). */
  submitPublishSettings: (
    payload: PublishSettingsSubmitPayload,
  ) => Promise<void>;
  /** Re-run the last GitHub operation (after an error) without re-entering a form. */
  retryGithubExport: () => Promise<void>;

  /** Close the GitHub dialog/modal without submitting. */
  closeDialog: () => void;
  /** Dismiss the status/error strip (return to idle). */
  dismissStatus: () => void;
}

const ProjectExportContext = createContext<ProjectExportContextValue | null>(
  null,
);

/**
 * Lifts the project export state machine so every consumer in the
 * workspace (Header menu, SummaryStep, the publish settings modal) sees
 * the same `state`. `onEditorPushed` (the workspace's clearUnpushed) lets a
 * modal-initiated editor push clear the live "unpushed" flag, keeping the
 * editor toolbar's Push button in sync.
 */
export function ExportProvider({
  children,
  onEditorPushed,
}: {
  children: ReactNode;
  onEditorPushed?: () => void;
}) {
  const { activeWorkspace } = useActiveWorkspace();
  // Destructure only the export-relevant fields so that isDirty/lastModifiedAt
  // changes (triggered on every editor keystroke) do not invalidate the
  // callback identities that feed into the context value.
  const activeProjectId = activeWorkspace?.projectId;
  const activeProjectName = activeWorkspace?.name;
  const activeWizardData = activeWorkspace?.wizardData;
  const { isAuthenticated, signIn } = useExternalIntegration();
  const [state, setState] = useState<ExportState>({ kind: "idle" });

  // The connected repo + remembered publish preference for the active project.
  // Reloaded after each successful publish/push (via `linkRefresh`) so the
  // button label and branching reflect a just-completed first publish.
  const [githubLink, setGithubLink] = useState<GithubLinkData | null>(null);
  const [publishPrefs, setPublishPrefs] = useState<GitHubPublishPrefs | null>(
    null,
  );
  const [linkRefresh, setLinkRefresh] = useState(0);

  // Replayed by Retry; the latest editor clearUnpushed kept in a ref so the
  // push callbacks stay referentially stable.
  const lastOperationRef = useRef<LastOperation | null>(null);
  const onEditorPushedRef = useRef(onEditorPushed);
  onEditorPushedRef.current = onEditorPushed;

  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId) {
      setGithubLink(null);
      setPublishPrefs(null);
      return;
    }
    void (async () => {
      const persistence = getSavedProjectsPersistence();
      const res = await persistence.loadProjects();
      if (cancelled || !res.success) return;
      const project = res.value.find((p) => p.id === activeProjectId);
      setGithubLink(project?.githubLink ?? null);
      setPublishPrefs(project?.githubPublishPrefs ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, linkRefresh]);

  const canExport = activeWorkspace !== null;

  const connectedRepo = useMemo(
    () =>
      githubLink ? { owner: githubLink.owner, repo: githubLink.repo } : null,
    [githubLink],
  );

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

  // --- persistence helpers (client IDB only; token stays server-side) ---

  const persistGithubLink = useCallback(
    async (link: GithubLinkData) => {
      if (!activeProjectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const loadRes = await persistence.loadProjects();
        if (!loadRes.success) return;
        const updated = loadRes.value.map((p) =>
          p.id === activeProjectId
            ? { ...p, githubLink: link, updatedAt: Date.now() }
            : p,
        );
        const saveRes = await persistence.saveProjects(updated);
        if (!saveRes.success) {
          getLogger().warn("Failed to persist GitHub link to saved project");
        }
      } catch (e) {
        getLogger().errorWithException(
          e,
          "Failed to persist GitHub link to saved project",
        );
      }
    },
    [activeProjectId],
  );

  const persistCommitSha = useCallback(
    async (link: GithubLinkData, commitSha: string) => {
      await persistGithubLink({ ...link, lastCommitSha: commitSha });
    },
    [persistGithubLink],
  );

  const persistPublishPrefs = useCallback(
    async (prefs: GitHubPublishPrefs) => {
      if (!activeProjectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const loadRes = await persistence.loadProjects();
        if (!loadRes.success) return;
        const updated = loadRes.value.map((p) =>
          p.id === activeProjectId
            ? { ...p, githubPublishPrefs: prefs, updatedAt: Date.now() }
            : p,
        );
        const saveRes = await persistence.saveProjects(updated);
        if (saveRes.success) setPublishPrefs(prefs);
      } catch (e) {
        getLogger().errorWithException(e, "Failed to persist publish prefs");
      }
    },
    [activeProjectId],
  );

  // --- publish operations ---

  // Re-publish the regenerated scaffold. `owner` present → reuse the linked
  // repo (createRepo is idempotent on "already exists"); absent → create.
  const runScaffoldPublish = useCallback(
    async (args: ScaffoldPublishArgs) => {
      if (!activeProjectId) return;
      lastOperationRef.current = { kind: "scaffold", args };
      setState({ kind: "exporting", destination: "github" });

      const result = await postJson<GithubExportResponse>(
        "/api/export/github",
        {
          projectId: activeProjectId,
          owner: args.owner,
          repoName: args.repoName,
          isPrivate: args.isPrivate,
          commitMessage: args.commitMessage,
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
      const link = result.data.githubLink;
      if (link) await persistGithubLink(link);
      setLinkRefresh((n) => n + 1);
      setState({
        kind: "success",
        destination: "github",
        message: link
          ? `Pushed to ${link.owner}/${link.repo}`
          : "Pushed to GitHub",
        destinationUrl,
        githubLink: link ?? undefined,
      });
    },
    [activeProjectId, activeWizardData, persistGithubLink],
  );

  // Push the current editor (user/LLM) edits to the linked repo, incrementally.
  const runEditorPush = useCallback(
    async (commitMessage: string) => {
      if (!activeProjectId || !githubLink) return;
      lastOperationRef.current = { kind: "editor", message: commitMessage };

      const files = await loadEditorFiles(activeProjectId);
      if (Object.keys(files).length === 0) {
        setState({
          kind: "error",
          destination: "github",
          message: "No editor changes to push.",
        });
        return;
      }

      setState({ kind: "exporting", destination: "github" });
      const result = await postJson<PushGithubResponse>("/api/push/github", {
        projectId: activeProjectId,
        githubLink,
        files,
        message: commitMessage.trim() || "Update from HexaGen editor",
      });

      if (result.kind !== "success") {
        const message =
          result.kind === "http-error" && result.status === 401
            ? "GitHub session expired — sign in again to push."
            : result.message;
        setState({ kind: "error", destination: "github", message });
        return;
      }

      // Sync the live editor "unpushed" flag and persist the new commit sha.
      onEditorPushedRef.current?.();
      await persistCommitSha(githubLink, result.data.commitSha);
      setLinkRefresh((n) => n + 1);
      setState({
        kind: "success",
        destination: "github",
        message: `Pushed edits to ${githubLink.owner}/${githubLink.repo}`,
        destinationUrl: githubLink.htmlUrl,
        githubLink: { ...githubLink, lastCommitSha: result.data.commitSha },
      });
    },
    [activeProjectId, githubLink, persistCommitSha],
  );

  // Dispatch a chosen publish mode against the linked repo.
  const runMode = useCallback(
    async (mode: PublishMode, message: string) => {
      if (!githubLink) {
        setState({ kind: "dialog-open" });
        return;
      }
      if (mode === "scaffold") {
        await runScaffoldPublish({
          owner: githubLink.owner,
          repoName: githubLink.repo,
          isPrivate: false,
          commitMessage: message,
        });
      } else if (mode === "editor") {
        await runEditorPush(message);
      } else {
        // new-repo → name a brand-new repository in the create dialog.
        setState({ kind: "dialog-open" });
      }
    },
    [githubLink, runScaffoldPublish, runEditorPush],
  );

  const openSettingsModal = useCallback(async () => {
    if (!activeProjectId || !githubLink) return;
    const files = await loadEditorFiles(activeProjectId);
    const mode: PublishMode = publishPrefs?.mode ?? "scaffold";
    setState({
      kind: "settings-open",
      repo: { owner: githubLink.owner, repo: githubLink.repo },
      defaultMode: mode,
      defaultMessage: defaultPublishMessage(mode),
      defaultRemember: publishPrefs?.remember ?? false,
      hasEditorEdits: Object.keys(files).length > 0,
    });
  }, [activeProjectId, githubLink, publishPrefs]);

  const requestGithubExport = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    if (!activeProjectId) return;
    const action = decidePublishAction(Boolean(githubLink), publishPrefs);
    if (action.kind === "create-dialog") {
      // Not linked → first publish via the create dialog.
      setState({ kind: "dialog-open" });
      return;
    }
    if (action.kind === "run-remembered") {
      // Linked + remembered preference → run it directly, no modal.
      await runMode(action.mode, defaultPublishMessage(action.mode));
      return;
    }
    // Linked, no remembered preference → ask via the settings modal.
    await openSettingsModal();
  }, [
    isAuthenticated,
    signIn,
    activeProjectId,
    githubLink,
    publishPrefs,
    runMode,
    openSettingsModal,
  ]);

  // Return to the editable create form (e.g. after an error) without re-running
  // the auth guard — the user already authenticated to get here.
  const showGithubDialog = useCallback(() => {
    setState({ kind: "dialog-open" });
  }, []);

  const submitGithubExport = useCallback(
    async ({
      repoName,
      isPrivate,
      commitMessage,
    }: ExportDialogSubmitPayload) => {
      // No owner → create a new repo under the authenticated account.
      await runScaffoldPublish({ repoName, isPrivate, commitMessage });
    },
    [runScaffoldPublish],
  );

  const submitPublishSettings = useCallback(
    async ({ mode, commitMessage, remember }: PublishSettingsSubmitPayload) => {
      // Always persist the chosen `remember` state — otherwise unchecking it
      // can't clear a previously-stored `remember: true`, locking the user into
      // auto-publish (the button would keep skipping the modal).
      await persistPublishPrefs({ mode, remember });
      await runMode(mode, commitMessage);
    },
    [persistPublishPrefs, runMode],
  );

  const retryGithubExport = useCallback(async () => {
    const op = lastOperationRef.current;
    if (!op) return;
    if (op.kind === "scaffold") {
      await runScaffoldPublish(op.args);
    } else {
      await runEditorPush(op.message);
    }
  }, [runScaffoldPublish, runEditorPush]);

  const closeDialog = useCallback(() => {
    lastOperationRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const dismissStatus = useCallback(() => {
    lastOperationRef.current = null;
    setState({ kind: "idle" });
  }, []);

  // Memoized so consumers only re-render when the state machine or
  // a handler reference actually changes.
  const value = useMemo<ProjectExportContextValue>(
    () => ({
      state,
      canExport,
      isAuthenticated,
      connectedRepo,
      exportZip,
      requestGithubExport,
      showGithubDialog,
      openPublishSettings: openSettingsModal,
      submitGithubExport,
      submitPublishSettings,
      retryGithubExport,
      closeDialog,
      dismissStatus,
    }),
    [
      state,
      canExport,
      isAuthenticated,
      connectedRepo,
      exportZip,
      requestGithubExport,
      showGithubDialog,
      openSettingsModal,
      submitGithubExport,
      submitPublishSettings,
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
