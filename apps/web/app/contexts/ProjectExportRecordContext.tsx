"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { GitHubPublishPrefs } from "@hexagen/shared";

import { getSavedProjectsPersistence, getLogger } from "@/lib/wire.client";

import type { GithubLinkData } from "./export-state";

export interface ProjectExportRecordValue {
  /** The connected repo link for the active project, or null when unlinked. */
  githubLink: GithubLinkData | null;
  /** `githubLink` narrowed to the identity every consumer actually renders. */
  connectedRepo: { owner: string; repo: string } | null;
  /** The remembered publish preference for the active project, or null. */
  publishPrefs: GitHubPublishPrefs | null;
  /**
   * Persisted (IDB, #221-normalized) formState — the fallback source for the
   * export payload when the live workspace snapshot is somehow absent.
   */
  savedFormState: Record<string, unknown> | null;
  /**
   * The saved record's manifestYaml — the SOURCE OF TRUTH for imported
   * projects' exports (import round-trip integrity, Item 1.3). Wizard-authored
   * projects never read it.
   */
  savedManifestYaml: string | null;
  /**
   * Write a link through and adopt it in memory. Best-effort: the in-memory
   * value is adopted from the caller's (server-authoritative) link even when
   * the IDB write fails, so the UI never shows "not linked" after a publish
   * that GitHub accepted.
   */
  persistGithubLink: (link: GithubLinkData) => Promise<void>;
  /** Write the remembered publish preference through. */
  persistPublishPrefs: (prefs: GitHubPublishPrefs) => Promise<void>;
}

const ProjectExportRecordContext =
  createContext<ProjectExportRecordValue | null>(null);

/**
 * The ONE reader/writer of the active project's publish-relevant saved-record
 * fields (GOD-004). Before this existed, `githubLink` was loaded from IDB in
 * three independent places — the export provider, `useEditorPush`, and
 * `useConnectedRepo` — each with its own copy of the "find the project, read
 * `.githubLink`" logic and its own refresh timing, so a publish that updated
 * one left the others stale until an unrelated remount.
 *
 * `projectId` is a prop rather than a `useActiveWorkspace()` read so this
 * provider is mountable in a test without the workspace context.
 */
export function ProjectExportRecordProvider({
  projectId,
  children,
}: {
  projectId: string | undefined;
  children: ReactNode;
}) {
  const [githubLink, setGithubLink] = useState<GithubLinkData | null>(null);
  const [publishPrefs, setPublishPrefs] = useState<GitHubPublishPrefs | null>(
    null,
  );
  const [savedFormState, setSavedFormState] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [savedManifestYaml, setSavedManifestYaml] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setGithubLink(null);
      setPublishPrefs(null);
      setSavedFormState(null);
      setSavedManifestYaml(null);
      return;
    }
    // Clear the PREVIOUS project's manifest before the async load: during the
    // window between a project switch and loadProjects resolving, an export
    // would otherwise pair the NEW project's wizardData with the OLD project's
    // manifest. Nulling it makes the imported-manifest resolution fail closed
    // (blocking error) instead of exporting the wrong manifest.
    setSavedManifestYaml(null);
    void (async () => {
      const persistence = getSavedProjectsPersistence();
      const res = await persistence.loadProjects();
      if (cancelled || !res.success) return;
      const project = res.value.find((p) => p.id === projectId);
      setGithubLink(project?.githubLink ?? null);
      setPublishPrefs(project?.githubPublishPrefs ?? null);
      setSavedFormState(project?.formState ?? null);
      setSavedManifestYaml(project?.manifestYaml ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Record-level read-merge-write (ADR-0045): no pre-read + whole-array save —
  // that pattern persisted a possibly-stale snapshot of EVERY record, silently
  // reverting concurrent writers (the original githubLink.lastCommitSha
  // clobber). The port re-reads at write time and touches only this record.
  // NotFound (project deleted mid-flow) → warn + no-op: the publish itself
  // succeeded, there is just no record left to stamp.
  const persistGithubLink = useCallback(
    async (link: GithubLinkData) => {
      // Adopt the caller's link FIRST — it comes from the authoritative server
      // response, and the IDB write is best-effort, so `connectedRepo` must not
      // depend on persistence succeeding.
      setGithubLink(link);
      if (!projectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const res = await persistence.updateProjectRecord(projectId, (p) => ({
          ...p,
          githubLink: link,
          updatedAt: Date.now(),
        }));
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
    [projectId],
  );

  // Record-level for the same reason as persistGithubLink. NotFound → warn +
  // no-op (and no in-memory prefs update — nothing was durably remembered).
  const persistPublishPrefs = useCallback(
    async (prefs: GitHubPublishPrefs) => {
      if (!projectId) return;
      try {
        const persistence = getSavedProjectsPersistence();
        const res = await persistence.updateProjectRecord(projectId, (p) => ({
          ...p,
          githubPublishPrefs: prefs,
          updatedAt: Date.now(),
        }));
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
    [projectId],
  );

  const connectedRepo = useMemo(
    () =>
      githubLink ? { owner: githubLink.owner, repo: githubLink.repo } : null,
    [githubLink],
  );

  const value = useMemo<ProjectExportRecordValue>(
    () => ({
      githubLink,
      connectedRepo,
      publishPrefs,
      savedFormState,
      savedManifestYaml,
      persistGithubLink,
      persistPublishPrefs,
    }),
    [
      githubLink,
      connectedRepo,
      publishPrefs,
      savedFormState,
      savedManifestYaml,
      persistGithubLink,
      persistPublishPrefs,
    ],
  );

  return (
    <ProjectExportRecordContext.Provider value={value}>
      {children}
    </ProjectExportRecordContext.Provider>
  );
}

export function useProjectExportRecord(): ProjectExportRecordValue {
  const ctx = useContext(ProjectExportRecordContext);
  if (!ctx) {
    throw new Error(
      "useProjectExportRecord must be used within ProjectExportRecordProvider",
    );
  }
  return ctx;
}
