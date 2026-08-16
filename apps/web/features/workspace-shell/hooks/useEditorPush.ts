"use client";

import { useCallback, useRef, useState } from "react";

import { postJson } from "@/lib/fetch-json";
import {
  mapGithubPublishFailure,
  type GithubPublishErrorCode,
} from "@/lib/github-publish-errors";
import { useProjectExportRecord } from "@/contexts/ProjectExportRecordContext";

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
  /** Actionable failure code driving the Reconnect/sign-in affordance; null
   * for non-actionable failures (and whenever pushError is null). */
  pushErrorCode: GithubPublishErrorCode | null;
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
 * Owns the editor → GitHub "Push" flow: commits the current file set via
 * `/api/push/github` (token stays server-side), then clears `unpushed` and
 * records the new `lastCommitSha`.
 *
 * The connected repo and the `lastCommitSha` write both come from the publish
 * record context (GOD-004). This hook used to run its OWN `loadProjects()`
 * effect and its own `updateProjectRecord` write, so mounting the workspace
 * read the saved-projects store twice and a publish through the header menu
 * left the toolbar's copy of the link stale until a remount.
 */
export function useEditorPush({
  projectId,
  files,
  unpushed,
  onPushed,
}: UseEditorPushArgs): EditorPushState {
  const { githubLink, connectedRepo, persistGithubLink } =
    useProjectExportRecord();
  const [isPushing, setIsPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushErrorCode, setPushErrorCode] =
    useState<GithubPublishErrorCode | null>(null);

  // Keep the latest file set in a ref so `onPush` stays referentially stable
  // (the toolbar button identity doesn't churn on every keystroke).
  const filesRef = useRef(files);
  filesRef.current = files;

  const handlePush = useCallback(async () => {
    if (!projectId || !githubLink || isPushing) return;
    const currentFiles = filesRef.current;
    if (Object.keys(currentFiles).length === 0) return;

    setIsPushing(true);
    setPushError(null);
    setPushErrorCode(null);
    try {
      const result = await postJson<PushGithubResponse>("/api/push/github", {
        projectId,
        githubLink,
        files: currentFiles,
        message: "Update from HexaGen editor",
      });

      if (result.kind === "success") {
        onPushed();
        // Best-effort and self-contained: persistGithubLink adopts the new sha
        // in memory first and contains both failed Results and a THROWING
        // port, so an escaped rejection can't reject the push flow here (which
        // has no catch arm) and skip the commit-page open after GitHub already
        // accepted the commit.
        await persistGithubLink({
          ...githubLink,
          lastCommitSha: result.data.commitSha,
        });
        window.open(result.data.commitUrl, "_blank", "noopener,noreferrer");
        return;
      }

      // Code-driven mapping now (was a raw status===401 check); the mapper
      // deliberately keeps the codeless-401 → session-expired fallback verbatim.
      const mapped = mapGithubPublishFailure(result, "push");
      setPushError(mapped.message);
      setPushErrorCode(mapped.code);
    } finally {
      setIsPushing(false);
    }
  }, [projectId, githubLink, isPushing, onPushed, persistGithubLink]);

  const hasFiles = Object.keys(files).length > 0;

  return {
    // `() => Promise<void>` is assignable to the `() => void` handler; returning
    // the memoized callback keeps the button identity stable between renders.
    onPush: githubLink ? handlePush : undefined,
    canPush: Boolean(githubLink) && unpushed && hasFiles && !isPushing,
    isPushing,
    connectedRepo,
    pushError,
    pushErrorCode,
  };
}
