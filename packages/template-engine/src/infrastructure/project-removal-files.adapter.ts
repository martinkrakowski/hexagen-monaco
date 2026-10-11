import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Stats } from "node:fs";
import { conflictFilePath, normaliseRecordedPath } from "../domain/index.js";
import type { RecordedFileState } from "../domain/index.js";
import { RemovalDeleteError } from "../application/ports/project-removal-files.port.js";
import type {
  ProjectRemovalFilesPort,
  RemovalDeleteOutcome,
  RemovalDeleteRequest,
  RemovalSkipReason,
} from "../application/ports/project-removal-files.port.js";

/**
 * The filesystem side of `hexagen remove` (proposal 2026-10-10, lane Q3b) —
 * the ONLY code in the codebase that deletes files in a user's project.
 * Every path goes through `locate`, which refuses anything that is not a
 * plain file reached without a symlink and strictly inside the real project
 * root; when in doubt it skips and reports. It never uses `fs.rm` and never
 * deletes recursively.
 */

type Located =
  | { kind: "unsafe" }
  | { kind: "absent" }
  | { kind: "other"; detail: string; unreadable?: true }
  | { kind: "file"; abs: string };

export class FileSystemProjectRemovalFiles implements ProjectRemovalFilesPort {
  /**
   * Resolves one normalised relative path under the real project root.
   * Refuses (as `unsafe`) anything `normaliseRecordedPath` would change —
   * the caller must pass normalised paths, and this is where that contract
   * is enforced again. Never follows a symbolic link, anywhere in the path.
   * The alias check (step 6) catches spellings that reach a protected
   * folder under another name — a Windows short name such as `GIT~1`, or a
   * letter-case variant.
   */
  private async locate(realRoot: string, rel: string): Promise<Located> {
    if (normaliseRecordedPath(rel) !== rel) {
      return { kind: "unsafe" };
    }
    const segments = rel.split("/");
    let current = realRoot;
    for (let i = 0; i < segments.length - 1; i += 1) {
      current = path.join(current, segments[i]);
      let stat: Stats;
      try {
        stat = await fs.lstat(current);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return { kind: "absent" };
        return {
          kind: "other",
          detail: code ?? "lstat error",
          unreadable: true,
        };
      }
      if (stat.isSymbolicLink()) {
        return { kind: "other", detail: "symbolic link in the path" };
      }
      if (!stat.isDirectory()) {
        return { kind: "other", detail: "not a directory" };
      }
    }
    const abs = path.join(current, segments[segments.length - 1]);
    let stat: Stats;
    try {
      stat = await fs.lstat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { kind: "absent" };
      return { kind: "other", detail: code ?? "lstat error", unreadable: true };
    }
    if (stat.isSymbolicLink()) {
      return { kind: "other", detail: "symbolic link" };
    }
    if (!stat.isFile()) {
      return { kind: "other", detail: "not a plain file" };
    }
    if (!abs.startsWith(realRoot + path.sep)) {
      return { kind: "unsafe" };
    }
    // The file itself is canonicalised, not only its folder: a short name
    // or a case variant of the LAST segment (the registry file, or `.git`
    // when it is a file) must be seen under its real name too.
    let realAbs: string;
    try {
      realAbs = await fs.realpath(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { kind: "absent" };
      return {
        kind: "other",
        detail: code ?? "realpath error",
        unreadable: true,
      };
    }
    const relReal = path.relative(realRoot, realAbs).split(path.sep).join("/");
    if (relReal.startsWith("..") || normaliseRecordedPath(relReal) === null) {
      return { kind: "unsafe" };
    }
    return { kind: "file", abs };
  }

  async inspect(
    projectRoot: string,
    paths: readonly string[],
  ): Promise<Map<string, RecordedFileState>> {
    const realRoot = await fs.realpath(projectRoot);
    const states = new Map<string, RecordedFileState>();
    for (const rel of paths) {
      const located = await this.locate(realRoot, rel);
      if (located.kind === "unsafe") {
        states.set(rel, { kind: "other", detail: "unsafe path" });
      } else if (located.kind === "absent") {
        states.set(rel, { kind: "absent" });
      } else if (located.kind === "other") {
        states.set(rel, { kind: "other", detail: located.detail });
      } else {
        try {
          const content = await fs.readFile(located.abs, "utf-8");
          states.set(rel, { kind: "file", contentHash: sha256(content) });
        } catch (err) {
          states.set(rel, {
            kind: "other",
            detail: (err as NodeJS.ErrnoException).code ?? "read error",
          });
        }
      }
    }
    return states;
  }
  /**
   * Deletes the requested files, re-locating and (unless `--force`)
   * re-hashing each one IMMEDIATELY before it is unlinked, so a file that
   * changed after `inspect` is kept. Files already deleted stay deleted;
   * any error other than a vanished file (ENOENT on unlink) is thrown,
   * with how many were deleted first.
   */
  async deleteFiles(
    projectRoot: string,
    requests: readonly RemovalDeleteRequest[],
  ): Promise<RemovalDeleteOutcome> {
    const realRoot = await fs.realpath(projectRoot);
    const deleted: string[] = [];
    const skipped: { path: string; reason: RemovalSkipReason }[] = [];
    for (const request of requests) {
      const located = await this.locate(realRoot, request.path);
      if (located.kind === "unsafe") {
        skipped.push({ path: request.path, reason: "unsafe-path" });
        continue;
      }
      if (located.kind === "absent") {
        skipped.push({ path: request.path, reason: "absent" });
        continue;
      }
      if (located.kind === "other") {
        skipped.push({
          path: request.path,
          reason: located.unreadable ? "unreadable" : "not-a-plain-file",
        });
        continue;
      }
      if (request.expectedHashes !== null) {
        let hash: string;
        try {
          hash = sha256(await fs.readFile(located.abs, "utf-8"));
        } catch {
          skipped.push({ path: request.path, reason: "unreadable" });
          continue;
        }
        if (!request.expectedHashes.includes(hash)) {
          skipped.push({ path: request.path, reason: "changed" });
          continue;
        }
      }
      try {
        await fs.unlink(located.abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          skipped.push({ path: request.path, reason: "absent" });
          continue;
        }
        throw new RemovalDeleteError(
          `Failed to delete ${request.path} after ${deleted.length} file(s) were already deleted: ` +
            (err as Error).message,
          request.path,
          { deleted, skipped },
        );
      }
      deleted.push(request.path);
    }
    return { deleted, skipped };
  }

  /**
   * Removes the folders the deletions left empty, walking upward from each
   * deleted file's parent and stopping at the first folder that is not
   * empty — always at the project root, which is never removed. Only ever
   * `fs.rmdir` on a real directory (a symbolic link stops the walk); never
   * `fs.rm`, never recursive.
   */
  async pruneEmptyDirs(
    projectRoot: string,
    deletedPaths: readonly string[],
  ): Promise<string[]> {
    const realRoot = await fs.realpath(projectRoot);
    const removed = new Set<string>();
    for (const rel of deletedPaths) {
      if (normaliseRecordedPath(rel) !== rel) continue;
      let current = path.dirname(path.join(realRoot, rel));
      while (current !== realRoot && current.startsWith(realRoot + path.sep)) {
        let stat: Stats;
        try {
          stat = await fs.lstat(current);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") break;
          throw err;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) break;
        // `lstat` does not follow the LAST component only: a symbolic link
        // higher up would lead this walk out of the project. The folder's
        // real path must be the path walked, or the walk stops.
        try {
          if ((await fs.realpath(current)) !== current) break;
        } catch {
          break;
        }
        try {
          await fs.rmdir(current);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") {
            break;
          }
          throw err;
        }
        removed.add(path.relative(realRoot, current).split(path.sep).join("/"));
        current = path.dirname(current);
      }
    }
    return [...removed].sort();
  }

  /** The `.hexagen-update` conflict copies that exist beside the given paths. Reads only. */
  async existingConflictCopies(
    projectRoot: string,
    paths: readonly string[],
  ): Promise<string[]> {
    const realRoot = await fs.realpath(projectRoot);
    const copies: string[] = [];
    for (const rel of paths) {
      const conflictRel = conflictFilePath(rel);
      const located = await this.locate(realRoot, conflictRel);
      if (located.kind === "file") {
        copies.push(conflictRel);
      }
    }
    return copies;
  }
}

/** Identical to the emitter's hash, so an unchanged emitted file has the recorded hash. */
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
