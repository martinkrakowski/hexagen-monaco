export interface GitHubLink {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly lastCommitSha: string | null;
  readonly htmlUrl: string;
}

/**
 * What the primary "Publish to GitHub" button does for an already-linked
 * project (one that has a `githubLink`):
 * - "scaffold"  — re-publish the regenerated scaffold to the linked repo.
 * - "editor"    — push the current editor (user/LLM) edits to the linked repo.
 * - "new-repo"  — publish to a brand-new repository instead.
 */
export type PublishMode = "scaffold" | "editor" | "new-repo";

export interface GitHubPublishPrefs {
  /** Remembered push behavior for the linked repo. */
  readonly mode: PublishMode;
  /** When true, the button runs `mode` directly without opening the modal. */
  readonly remember: boolean;
}

export interface SavedProject {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly formState: Record<string, unknown>;
  readonly manifestYaml: string;
  readonly githubLink?: GitHubLink;
  /** Remembered GitHub publish preference (set via the publish settings modal). */
  readonly githubPublishPrefs?: GitHubPublishPrefs;
}
