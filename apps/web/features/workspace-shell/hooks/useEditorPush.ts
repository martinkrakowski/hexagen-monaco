"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubLink } from "@hexagen/shared";

import { getSavedProjectsPersistence, getLogger } from "@/lib/wire.client";
import { postJson } from "@/lib/fetch-json";

interface PushGithubResponse {
  success: boolean;
  commitSha: string;
  commitUrl: string;
}

export interface EditorPushState {
  /** Defined only when a repo is connected — gates the toolbar Push button. */
  onPush?: () => void;
  canPush: boolean;
  isPushing: boolean;
  connectedRepo: { owner: string; repo: string } | null;
  /** Last failure message (e.g. re-auth needed); null when idle/succeeded. */
  pushError: string | null;
}

interface UseEditorPushArgs {
  projectId: string | null;
  /** Current editor file contents (path → content) to commit. */
  files: Record<string, string>;
  /** Workspace-level "edited since last push" flag. */
  unpushed: boolean;
  /** Clears the workspace `unpushed` flag after a successful push. */
  onPushed: () => void;
}

/**
 * Owns the editor → GitHub "Push" flow: resolves the connected repo from the
 * active SavedProject, commits the current file set via `/api/push/github`
 * (token stays server-side), then clears `unpushed` and records the new
 * `lastCommitSha` on the SavedProject (client IDB).
 */
export function useEditorPush({
  projectId,
  files,
  unpushed,
  onPushed,
}: UseEditorPushArgs): EditorPushState {
  const [githubLink, setGithubLink] = useState<GitHubLink | null>(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  // Keep the latest file set in a ref so `onPush` stays referentially stable
  // (the toolbar button identity doesn't churn on every keystroke).
  const filesRef = useRef(files);
  filesRef.current = files;

  // Resolve the connected repo for the active project from persisted state.
  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setGithubLink(null);
      return;
    }
    void (async () => {
      const persistence = getSavedProjectsPersistence();
      const result = await persistence.loadProjects();
      if (cancelled) return;
      if (!result.success) {
        setGithubLink(null);
        return;
      }
      const project = result.value.find((p) => p.id === projectId);
      setGithubLink(project?.githubLink ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Record-level read-merge-write (ADR-0045): no pre-read + whole-array save —
  // that persisted a possibly-stale snapshot of EVERY record, which could
  // silently revert concurrent writers (this very field was the original
  // lastCommitSha clobber). NotFound (project deleted mid-push) → warn +
  // no-op: the push itself succeeded, there is just no record left to stamp.
  const persistCommitSha = useCallback(
    async (link: GitHubLink, commitSha: string) => {
      if (!projectId) return;
      const persistence = getSavedProjectsPersistence();
      const nextLink: GitHubLink = { ...link, lastCommitSha: commitSha };
      // Contain a THROWING port too, not just failed Results: handlePush has
      // no catch arm, so an escaped rejection would reject the whole push flow
      // — skipping the commit-page open — after GitHub already accepted the
      // commit. Mirrors the throwing-port hardening in useSavedProjects.
      try {
        const result = await persistence.updateProjectRecord(
          projectId,
          (p) => ({
            ...p,
            githubLink: nextLink,
            updatedAt: Date.now(),
          }),
        );
        if (result.success) setGithubLink(nextLink);
        else {
          getLogger().warn(
            result.error.kind === "NotFound"
              ? "Skipped persisting commit sha — the saved project no longer exists"
              : "Failed to persist commit sha to saved project",
          );
        }
      } catch {
        getLogger().warn("Failed to persist commit sha to saved project");
      }
    },
    [projectId],
  );

  const handlePush = useCallback(async () => {
    if (!projectId || !githubLink || isPushing) return;
    const currentFiles = filesRef.current;
    if (Object.keys(currentFiles).length === 0) return;

    setIsPushing(true);
    setPushError(null);
    try {
      const result = await postJson<PushGithubResponse>("/api/push/github", {
        projectId,
        githubLink,
        files: currentFiles,
        message: "Update from HexaGen editor",
      });

      if (result.kind === "success") {
        onPushed();
        await persistCommitSha(githubLink, result.data.commitSha);
        window.open(result.data.commitUrl, "_blank", "noopener,noreferrer");
        return;
      }

      if (result.kind === "http-error" && result.status === 401) {
        setPushError("GitHub session expired — sign in again to push.");
      } else {
        setPushError(result.message);
      }
    } finally {
      setIsPushing(false);
    }
  }, [projectId, githubLink, isPushing, onPushed, persistCommitSha]);

  const connectedRepo = useMemo(
    () =>
      githubLink ? { owner: githubLink.owner, repo: githubLink.repo } : null,
    [githubLink],
  );

  const hasFiles = Object.keys(files).length > 0;

  return {
    // `() => Promise<void>` is assignable to the `() => void` handler; returning
    // the memoized callback keeps the button identity stable between renders.
    onPush: githubLink ? handlePush : undefined,
    canPush: Boolean(githubLink) && unpushed && hasFiles && !isPushing,
    isPushing,
    connectedRepo,
    pushError,
  };
}
