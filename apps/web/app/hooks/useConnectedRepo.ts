"use client";

import { useEffect, useState } from "react";

import { getSavedProjectsPersistence } from "../lib/wire.client";

/**
 * Resolves the connected GitHub repo (owner/repo) for a project from the
 * persisted `SavedProject.githubLink` (client-side IDB). Returns null when the
 * project isn't connected yet.
 *
 * `refreshKey` lets callers force a re-read after an event that may have changed
 * the link (e.g. a successful wizard publish) without changing `projectId`.
 */
export function useConnectedRepo(
  projectId: string | null | undefined,
  refreshKey?: unknown,
): { owner: string; repo: string } | null {
  const [connectedRepo, setConnectedRepo] = useState<{
    owner: string;
    repo: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setConnectedRepo(null);
      return;
    }
    void (async () => {
      const persistence = getSavedProjectsPersistence();
      const result = await persistence.loadProjects();
      if (cancelled) return;
      if (!result.success) {
        setConnectedRepo(null);
        return;
      }
      const link = result.value.find((p) => p.id === projectId)?.githubLink;
      setConnectedRepo(link ? { owner: link.owner, repo: link.repo } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  return connectedRepo;
}
