import type { RecordedFileState } from "../../domain/index.js";

export interface RemovalDeleteRequest {
  /** Normalised relative path (normaliseRecordedPath's output). */
  path: string;
  /** Delete only if the content hash is one of these. `null`: delete whatever the content (--force). */
  expectedHashes: readonly string[] | null;
}
export type RemovalSkipReason =
  | "absent"
  | "changed"
  | "not-a-plain-file"
  /** The file could not be examined or read (a permission error, for one). It is kept. */
  | "unreadable"
  | "unsafe-path";
export interface RemovalDeleteOutcome {
  deleted: string[];
  skipped: { path: string; reason: RemovalSkipReason }[];
}
/**
 * A deletion failed part-way. `partial` holds what WAS deleted and skipped
 * before the failure, so the caller can still prune and report; `path` is
 * the file that could not be deleted.
 */
export class RemovalDeleteError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly partial: RemovalDeleteOutcome,
  ) {
    super(message);
    this.name = "RemovalDeleteError";
  }
}
export interface ProjectRemovalFilesPort {
  /** The state of each path under the project root. Reads only. One entry per given path. */
  inspect(
    projectRoot: string,
    paths: readonly string[],
  ): Promise<Map<string, RecordedFileState>>;
  /** Deletes the requested files, re-checking each one immediately before it is unlinked. */
  deleteFiles(
    projectRoot: string,
    requests: readonly RemovalDeleteRequest[],
  ): Promise<RemovalDeleteOutcome>;
  /** Removes the folders the deletions left empty, upward, never the project root. Returns them (relative, posix). */
  pruneEmptyDirs(
    projectRoot: string,
    deletedPaths: readonly string[],
  ): Promise<string[]>;
  /** The `.hexagen-update` conflict copies that exist beside the given paths (relative, posix). Reads only. */
  existingConflictCopies(
    projectRoot: string,
    paths: readonly string[],
  ): Promise<string[]>;
}
