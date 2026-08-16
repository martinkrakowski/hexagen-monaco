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

import type { PublishMode } from "@hexagen/shared";

import { useExternalIntegration } from "@/contexts/ExternalIntegrationContext";
import { postJson } from "@/lib/fetch-json";
import { mapGithubPublishFailure } from "@/lib/github-publish-errors";
import { withFormStateDefaults } from "@/lib/form-state-defaults";
import { resolveImportedManifestPayload } from "@/lib/imported-manifest";
import { getEditorWorkspacePersistence } from "@/lib/wire.client";

import type { GithubLinkData, GithubPublishState } from "./export-state";
import type {
  PublishSettingsSubmitPayload,
  ScaffoldPublishSubmitPayload,
} from "./export-payloads";
import { decidePublishAction, defaultPublishMessage } from "./publish-settings";
import { useProjectExportRecord } from "./ProjectExportRecordContext";

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

export interface GithubPublishContextValue {
  state: GithubPublishState;
  isAuthenticated: boolean;
  /** True while a publish/push is in flight (feeds the shared "busy" affordances). */
  isPublishing: boolean;

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
  submitGithubExport: (payload: ScaffoldPublishSubmitPayload) => Promise<void>;
  /** Submit the publish-settings modal (mode + commit message + remember). */
  submitPublishSettings: (
    payload: PublishSettingsSubmitPayload,
  ) => Promise<void>;
  /** Re-run the last GitHub operation (after an error) without re-entering a form. */
  retryGithubExport: () => Promise<void>;
  /**
   * Re-run the GitHub OAuth round-trip. A fresh sign-in is the ONLY
   * token-refresh path (the jwt callback stores the access token only on
   * sign-in), so this is how a user upgrades a token minted before the app
   * requested the `workflow` scope. The in-flight redirect abandons dialog
   * state by design.
   */
  reconnectGithub: () => void;
  /** Close the GitHub dialog/modal without submitting. */
  closeDialog: () => void;
}

const GithubPublishContext = createContext<GithubPublishContextValue | null>(
  null,
);

/**
 * The GitHub publish flow: create dialog, publish-settings modal, scaffold
 * publish and editor push (GOD-004).
 *
 * The saved-record reads and writes it needs — the connected link and the
 * remembered preference — come from `useProjectExportRecord`, so this module
 * owns publish POLICY and the routes, and owns no persistence of its own.
 */
export function GithubPublishProvider({
  projectId,
  wizardData,
  onEditorPushed,
  children,
}: {
  projectId: string | undefined;
  /** The live workspace snapshot; primary over the saved record's formState. */
  wizardData: Record<string, unknown> | undefined;
  /** The workspace's `clearUnpushed`, so a modal-initiated push syncs the toolbar. */
  onEditorPushed?: () => void;
  children: ReactNode;
}) {
  const { isAuthenticated, signIn } = useExternalIntegration();
  const {
    githubLink,
    publishPrefs,
    savedFormState,
    savedManifestYaml,
    persistGithubLink,
    persistPublishPrefs,
  } = useProjectExportRecord();
  const [state, setState] = useState<GithubPublishState>({ kind: "idle" });

  // Replayed by Retry; the latest editor clearUnpushed kept in a ref so the
  // push callbacks stay referentially stable.
  const lastOperationRef = useRef<LastOperation | null>(null);
  const onEditorPushedRef = useRef(onEditorPushed);
  onEditorPushedRef.current = onEditorPushed;

  // Re-publish the regenerated scaffold. `owner` present → reuse the linked
  // repo (createRepo is idempotent on "already exists"); absent → create.
  const runScaffoldPublish = useCallback(
    async (args: ScaffoldPublishArgs) => {
      if (!projectId) return;
      lastOperationRef.current = { kind: "scaffold", args };
      // Same fail-closed imported-manifest resolution as the ZIP path, from the
      // one shared resolver (REA-005). lastOperationRef stays set so Retry
      // re-checks after a fix.
      const manifestPayload = resolveImportedManifestPayload(
        wizardData ?? savedFormState,
        savedManifestYaml,
      );
      if (!manifestPayload.ok) {
        setState({ kind: "error", message: manifestPayload.message });
        return;
      }
      setState({ kind: "publishing" });

      const result = await postJson<GithubExportResponse>(
        "/api/export/github",
        {
          projectId,
          owner: args.owner,
          repoName: args.repoName,
          isPrivate: args.isPrivate,
          commitMessage: args.commitMessage,
          // Same precedence as the ZIP path: live primary, IDB fallback, normalized.
          // For imported projects `manifest` rides along and wins server-side;
          // wizardData still carries addOnsAnswers.
          wizardData: withFormStateDefaults(wizardData ?? savedFormState),
          ...manifestPayload.extra,
        },
      );

      if (result.kind !== "success") {
        // Besides threading the actionable code, the mapper also swaps the
        // session-expired copy in for reauth_required — previously this path
        // rendered the raw server message for an expired session (intentional
        // improvement over the old blanket `result.message`).
        const mapped = mapGithubPublishFailure(result, "publish");
        setState({
          kind: "error",
          message: mapped.message,
          ...(mapped.code ? { code: mapped.code } : {}),
        });
        return;
      }

      const destinationUrl = result.data.destinationUrl;
      const link = result.data.githubLink;
      // persistGithubLink adopts the server-authoritative link in memory before
      // the best-effort IDB write, so connectedRepo and decidePublishAction
      // can't read stale "not linked" state in the window before it completes.
      if (link) await persistGithubLink(link);
      setState({
        kind: "success",
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
        // ALSO thread the raw warning strings (degraded-publish detail, e.g.
        // "Skipped .github/workflows/…") — the counts above can't distinguish
        // add-on overrides from workflow-scope skips, the strings can.
        warnings: result.data.warnings?.length
          ? result.data.warnings
          : undefined,
      });
    },
    [
      projectId,
      wizardData,
      savedFormState,
      savedManifestYaml,
      persistGithubLink,
    ],
  );

  // Push the current editor (user/LLM) edits to the linked repo, incrementally.
  const runEditorPush = useCallback(
    async (commitMessage: string) => {
      if (!projectId || !githubLink) return;
      lastOperationRef.current = { kind: "editor", message: commitMessage };

      const files = await loadEditorFiles(projectId);
      if (Object.keys(files).length === 0) {
        setState({ kind: "error", message: "No editor changes to push." });
        return;
      }

      setState({ kind: "publishing" });
      const result = await postJson<PushGithubResponse>("/api/push/github", {
        projectId,
        githubLink,
        files,
        message: commitMessage.trim() || "Update from HexaGen editor",
      });

      if (result.kind !== "success") {
        // The mapper's codeless-401 fallback preserves the pre-existing
        // session-expired copy verbatim; typed codes additionally light up the
        // Reconnect/sign-in affordance in the dialog.
        const mapped = mapGithubPublishFailure(result, "push");
        setState({
          kind: "error",
          message: mapped.message,
          ...(mapped.code ? { code: mapped.code } : {}),
        });
        return;
      }

      // Sync the live editor "unpushed" flag, then record the new commit sha
      // (in-memory immediately, IDB best-effort).
      onEditorPushedRef.current?.();
      const nextLink = { ...githubLink, lastCommitSha: result.data.commitSha };
      await persistGithubLink(nextLink);
      setState({
        kind: "success",
        message: `Pushed edits to ${githubLink.owner}/${githubLink.repo}`,
        destinationUrl: githubLink.htmlUrl,
        githubLink: nextLink,
      });
    },
    [projectId, githubLink, persistGithubLink],
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
    if (!projectId || !githubLink) return;
    const files = await loadEditorFiles(projectId);
    const mode: PublishMode = publishPrefs?.mode ?? "scaffold";
    setState({
      kind: "settings-open",
      repo: { owner: githubLink.owner, repo: githubLink.repo },
      defaultMode: mode,
      defaultMessage: defaultPublishMessage(mode),
      defaultRemember: publishPrefs?.remember ?? false,
      hasEditorEdits: Object.keys(files).length > 0,
    });
  }, [projectId, githubLink, publishPrefs]);

  const requestGithubExport = useCallback(async () => {
    if (!isAuthenticated) {
      await signIn();
      return;
    }
    if (!projectId) return;
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
    projectId,
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
    }: ScaffoldPublishSubmitPayload) => {
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

  // Fire-and-forget: signIn navigates away to the OAuth provider, so there is
  // no meaningful completion to await client-side (see the JSDoc above).
  const reconnectGithub = useCallback(() => {
    void signIn();
  }, [signIn]);

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

  const value = useMemo<GithubPublishContextValue>(
    () => ({
      state,
      isAuthenticated,
      isPublishing: state.kind === "publishing",
      requestGithubExport,
      showGithubDialog,
      openPublishSettings: openSettingsModal,
      submitGithubExport,
      submitPublishSettings,
      retryGithubExport,
      reconnectGithub,
      closeDialog,
    }),
    [
      state,
      isAuthenticated,
      requestGithubExport,
      showGithubDialog,
      openSettingsModal,
      submitGithubExport,
      submitPublishSettings,
      retryGithubExport,
      reconnectGithub,
      closeDialog,
    ],
  );

  return (
    <GithubPublishContext.Provider value={value}>
      {children}
    </GithubPublishContext.Provider>
  );
}

export function useGithubPublish(): GithubPublishContextValue {
  const ctx = useContext(GithubPublishContext);
  if (!ctx) {
    throw new Error("useGithubPublish must be used within ExportProvider");
  }
  return ctx;
}
