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
import { withFormStateDefaults } from "@/lib/form-state-defaults";
import {
  isImportedFormState,
  parseImportedManifest,
} from "@/lib/imported-manifest";
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
  warnings?: string[];
  errors?: string[];
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
  // Loaded on mount / project change; the publish and prefs handlers also set
  // these directly on success, so the UI never depends on an async re-read for
  // immediate correctness.
  const [githubLink, setGithubLink] = useState<GithubLinkData | null>(null);
  const [publishPrefs, setPublishPrefs] = useState<GitHubPublishPrefs | null>(
    null,
  );
  // Persisted (IDB, #221-normalized) formState — the fallback source for the
  // export payload when the live workspace snapshot is somehow absent.
  const [savedFormState, setSavedFormState] = useState<Record<
    string,
    unknown
  > | null>(null);
  // The saved record's manifestYaml — the SOURCE OF TRUTH for imported
  // projects' exports (import round-trip integrity, Item 1.3). Wizard-authored
  // projects never read it here.
  const [savedManifestYaml, setSavedManifestYaml] = useState<string | null>(
    null,
  );

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
      setSavedFormState(null);
      setSavedManifestYaml(null);
      return;
    }
    // Clear the PREVIOUS project's manifest before the async load: during the
    // window between a project switch and loadProjects resolving, an export
    // would otherwise pair the NEW project's wizardData with the OLD project's
    // manifest. Nulling it makes resolveManifestPayload fail closed (blocking
    // error) instead of exporting the wrong manifest.
    setSavedManifestYaml(null);
    void (async () => {
      const persistence = getSavedProjectsPersistence();
      const res = await persistence.loadProjects();
      if (cancelled || !res.success) return;
      const project = res.value.find((p) => p.id === activeProjectId);
      setGithubLink(project?.githubLink ?? null);
      setPublishPrefs(project?.githubPublishPrefs ?? null);
      setSavedFormState(project?.formState ?? null);
      setSavedManifestYaml(project?.manifestYaml ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  const canExport = activeWorkspace !== null;

  const connectedRepo = useMemo(
    () =>
      githubLink ? { owner: githubLink.owner, repo: githubLink.repo } : null,
    [githubLink],
  );

  // Import round-trip integrity (Item 1.3): for an IMPORTED project the export
  // payload carries the parsed saved manifest — the routes' existing
  // `body.manifest ?? wizardToManifest(body.wizardData)` fallback then never
  // runs the degraded projection. Wizard-authored projects return no extra
  // field, keeping the live-first wizardData path (#222) byte-identical.
  // FAIL CLOSED: a corrupt saved manifest yields a blocking error instead of a
  // silent wizardData fallback (that fallback IS the data-loss path).
  const resolveManifestPayload = useCallback(():
    | { ok: true; extra: Record<string, unknown> }
    | { ok: false; message: string } => {
    const formStateForExport = activeWizardData ?? savedFormState;
    if (!isImportedFormState(formStateForExport)) {
      return { ok: true, extra: {} };
    }
    const parsed = parseImportedManifest(savedManifestYaml);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    return { ok: true, extra: { manifest: parsed.manifest } };
  }, [activeWizardData, savedFormState, savedManifestYaml]);

  const exportZip = useCallback(async () => {
    if (!activeProjectId) return;
    const manifestPayload = resolveManifestPayload();
    if (!manifestPayload.ok) {
      setState({
        kind: "error",
        destination: "zip",
        message: manifestPayload.message,
      });
      return;
    }
    setState({ kind: "exporting", destination: "zip" });

    const result = await postForBlob("/api/export/zip", {
      projectId: activeProjectId,
      // Live workspace state primary (matches the code view); IDB formState as a
      // fallback; normalized so a legacy snapshot still carries addOnsAnswers.
      // wizardData is still sent alongside `manifest` for imported projects:
      // the route reads addOnsAnswers from it.
      wizardData: withFormStateDefaults(activeWizardData ?? savedFormState),
      ...manifestPayload.extra,
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
      notices: result.notices,
    });
  }, [
    activeProjectId,
    activeProjectName,
    activeWizardData,
    savedFormState,
    resolveManifestPayload,
  ]);

  // --- persistence helpers (client IDB only; token stays server-side) ---

  // Record-level read-merge-write (ADR-0045): no pre-read + whole-array save —
  // that pattern persisted a possibly-stale snapshot of EVERY record, silently
  // reverting concurrent writers (the original githubLink.lastCommitSha
  // clobber). The port re-reads at write time and touches only this record.
  // NotFound (project deleted mid-flow) → warn + no-op: the publish itself
  // succeeded, there is just no record left to stamp.
  const persistGithubLink = useCallback(
    async (link: GithubLinkData) => {
      if (!activeProjectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const res = await persistence.updateProjectRecord(
          activeProjectId,
          (p) => ({ ...p, githubLink: link, updatedAt: Date.now() }),
        );
        if (!res.success) {
          getLogger().warn(
            res.error.kind === "NotFound"
              ? "Skipped persisting GitHub link — the saved project no longer exists"
              : "Failed to persist GitHub link to saved project",
          );
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

  // Record-level for the same reason as persistGithubLink. NotFound → warn +
  // no-op (and no in-memory prefs update — nothing was durably remembered).
  const persistPublishPrefs = useCallback(
    async (prefs: GitHubPublishPrefs) => {
      if (!activeProjectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const res = await persistence.updateProjectRecord(
          activeProjectId,
          (p) => ({ ...p, githubPublishPrefs: prefs, updatedAt: Date.now() }),
        );
        if (res.success) setPublishPrefs(prefs);
        else {
          getLogger().warn(
            res.error.kind === "NotFound"
              ? "Skipped persisting publish prefs — the saved project no longer exists"
              : "Failed to persist publish prefs",
          );
        }
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
      const manifestPayload = resolveManifestPayload();
      if (!manifestPayload.ok) {
        // Fail closed (imported project, corrupt manifest) — same guard as the
        // ZIP path. lastOperationRef stays set so Retry re-checks after a fix.
        setState({
          kind: "error",
          destination: "github",
          message: manifestPayload.message,
        });
        return;
      }
      setState({ kind: "exporting", destination: "github" });

      const result = await postJson<GithubExportResponse>(
        "/api/export/github",
        {
          projectId: activeProjectId,
          owner: args.owner,
          repoName: args.repoName,
          isPrivate: args.isPrivate,
          commitMessage: args.commitMessage,
          // Same precedence as the ZIP path: live primary, IDB fallback, normalized.
          // For imported projects `manifest` rides along and wins server-side;
          // wizardData still carries addOnsAnswers.
          wizardData: withFormStateDefaults(activeWizardData ?? savedFormState),
          ...manifestPayload.extra,
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
      if (link) {
        // Set in-memory state immediately from the authoritative server response
        // — independent of the best-effort IDB write — so connectedRepo and
        // decidePublishAction can't read stale "not linked" state in the window
        // before persistence completes.
        setGithubLink(link);
        await persistGithubLink(link);
      }
      setState({
        kind: "success",
        destination: "github",
        message: link
          ? `Pushed to ${link.owner}/${link.repo}`
          : "Pushed to GitHub",
        destinationUrl,
        githubLink: link ?? undefined,
        // Surface add-on materialization notices (counts) on the publish result
        // — detail is committed to the repo's HEXAGEN-ADDON-NOTICES.md (PR 3a).
        notices:
          result.data.warnings?.length || result.data.errors?.length
            ? {
                warnings: result.data.warnings?.length ?? 0,
                errors: result.data.errors?.length ?? 0,
              }
            : undefined,
      });
    },
    [
      activeProjectId,
      activeWizardData,
      savedFormState,
      persistGithubLink,
      resolveManifestPayload,
    ],
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

      // Sync the live editor "unpushed" flag, update the in-memory link
      // immediately, then persist the new commit sha (best-effort IDB).
      onEditorPushedRef.current?.();
      const nextLink = { ...githubLink, lastCommitSha: result.data.commitSha };
      setGithubLink(nextLink);
      await persistCommitSha(githubLink, result.data.commitSha);
      setState({
        kind: "success",
        destination: "github",
        message: `Pushed edits to ${githubLink.owner}/${githubLink.repo}`,
        destinationUrl: githubLink.htmlUrl,
        githubLink: nextLink,
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
