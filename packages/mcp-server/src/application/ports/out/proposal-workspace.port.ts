import type { ProposalMeta, Result, Slice } from "@hexagen/shared";

/** One patch path, resolved against what is actually on disk. */
export type OnDiskPath =
  | {
      readonly path: string;
      /** The repo-relative on-disk spelling (real directories, real case). */
      readonly real: string;
    }
  | { readonly path: string; readonly problem: string };

/**
 * The repo working tree as `hexagen_propose_patch` sees it. Every method only
 * reads, except the two that write under `.hexagen/proposals/`; nothing here
 * can write anywhere else.
 */
export interface ProposalWorkspacePort {
  /** `.hexagen/slice.json`; a failure names why there is no usable slice. */
  readSlice(): Promise<Result<Slice, Error>>;
  /**
   * For each path: `fs.realpath` the deepest existing parent (or the file),
   * re-append the part that does not exist yet, and report the result
   * relative to the real repo root. A result outside the root, a dangling
   * symlink or a loop is a `problem`.
   */
  resolveOnDisk(
    paths: readonly string[],
  ): Promise<Result<readonly OnDiskPath[], Error>>;
  /** Stores `<id>.patch` exclusively under a fresh random id. */
  savePatch(patch: string): Promise<Result<{ id: string }, Error>>;
  /** Stores `<id>.json` exclusively. */
  saveMeta(meta: ProposalMeta): Promise<Result<void, Error>>;
  /** Removes a patch whose evidence or metadata could not be written. */
  discardPatch(id: string): Promise<void>;
}
