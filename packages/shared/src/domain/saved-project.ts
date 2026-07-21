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

/**
 * Current `SavedProject.schemaVersion` for newly written records. Single source
 * of truth for the *live* write path (the `useSavedProjects` hook). Migration
 * steps deliberately do NOT import this — each step stamps a frozen historical
 * version (v2, v3, v4 …), so bumping this constant must never retroactively move
 * an old migration's target.
 */
export const SAVED_PROJECT_SCHEMA_VERSION = 4;

/**
 * One authored message in a project planning layer. A multi-agent brainstorm is
 * not a `user`/`assistant` exchange, so `author` is a free-form label
 * ("Grok" | "Claude" | "You" | "Imported"), not a role enum.
 */
export interface ProjectLayerTurn {
  /** Stable identity — React keys, salvage-rule index shifts, and Phase-2/3
   * provenance all need it. Assigned at creation (`crypto.randomUUID()`). */
  readonly id: string;
  readonly author: string;
  /** Markdown. */
  readonly content: string;
  /** Optional timestamp. */
  readonly at?: number;
}

/**
 * A provenance link from a layer to another project artifact. Discriminated on
 * `type` so future link kinds ("produced-code", "informed-decision", …) slot
 * into the union without reshaping stored records. NOTE: the idb load
 * perimeter (`normalizeLayers`) whitelists the CURRENT union members and drops
 * anything else as mistyped — adding a link kind (or a layer `kind`) requires
 * a matching salvage-whitelist update in the same release, or older builds
 * will strip the new value on their next write.
 */
export interface ProducedManifestLink {
  /** This layer is the planning session the manifest was derived from. */
  readonly type: "produced-manifest";
  /** When the manifest was produced (epoch ms). */
  readonly at: number;
}

export type ProjectLayerLink = ProducedManifestLink;

/**
 * A provenance layer on a project. Phase 1 held only the brainstorm; Phase 2
 * adds `"decisions"` (an extracted summary of finalized decisions). The union
 * stays open for future `"research"` | … layers. `turns` is ordered: a v1
 * paste is one turn; a live session appends.
 */
export interface ProjectLayer {
  readonly id: string;
  readonly kind: "brainstorm" | "decisions";
  readonly title: string;
  readonly turns: readonly ProjectLayerTurn[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Provenance link to the artifact this layer produced (see ProjectLayerLink). */
  readonly link?: ProjectLayerLink;
  /** For a "decisions" layer: the brainstorm layer it was extracted from. */
  readonly sourceLayerId?: string;
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
  /**
   * Provenance layers (the planning/brainstorm session that produced the
   * manifest). Optional on the domain type — honest for raw/legacy records and
   * the write path; the load perimeter (`normalizeLoadedProjects`) defaults it to
   * `[]`, and the app-level `SavedProject` narrows it to a required array.
   */
  readonly layers?: readonly ProjectLayer[];
}
