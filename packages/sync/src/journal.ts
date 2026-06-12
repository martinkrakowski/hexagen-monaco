// journal.ts – per-run mutation journal for SyncEngine (plan PR-B1, RCA #4).
//
// Replaces the engine's old failure handling — `git reset --hard HEAD &&
// git clean -fd` against the whole workspace root — which destroyed the
// user's uncommitted work and every untracked file in the tree, including
// files sync never touched. The journal records the pre-image of every file
// sync actually mutates; on failure the engine replays it in REVERSE to
// restore exactly those files and nothing else. Untracked files sync never
// touched are structurally invisible to this mechanism — the data-loss class
// is gone by construction, not by policy.
//
// Scope: the journal tracks FILE CONTENT, not directory shape.
//   - Directory creation (the recursive mkdirs in layer-folders, stubs, apps,
//     shared-kernel, cross-context) is NOT journaled: an empty directory
//     carries no user data, git cannot see it, and knowing whether a
//     recursive mkdir actually created anything needs the existence probe
//     that lands with PR-B2's truthful counts.
//   - reap.ts is NOT journaled for the same reason: it only ever deletes
//     directories it has verified to be EMPTY.
//   - The preflight build (`npx turbo run build`), the lock file (its own
//     acquire/release lifecycle, released in the engine's finally), and the
//     atomic-write tmp files (self-cleaning in safeWriteFileAtomic's error
//     path) are deliberate exceptions — see the PR-B1 coverage table.
import fs from "node:fs/promises";
import path from "node:path";
import type { LoggerPort } from "@hexagen/shared";

/** What sync did to the file — determines the inverse op on rollback. */
export type JournalEntryKind = "created" | "overwritten" | "deleted";

export interface JournalEntry {
  /** Absolute path of the mutated file. */
  path: string;
  kind: JournalEntryKind;
  /**
   * Full pre-mutation content; `null` iff the file did not exist (kind
   * "created"). Held in memory for the run's lifetime — generated artifacts
   * are small text files, and a journal that spills to disk could itself
   * fail on the same broken substrate it exists to recover from.
   */
  preContent: string | null;
}

export interface RollbackFailure {
  path: string;
  /** The inverse op that was attempted, for the operator-facing print. */
  intended: string;
  error: string;
}

export interface RollbackOutcome {
  attempted: number;
  restored: number;
  failures: RollbackFailure[];
}

export class SyncJournal {
  private entries: JournalEntry[] = [];

  /**
   * Record a write BEFORE it is attempted. `preContent: null` means the file
   * did not exist (a create); a string is the full pre-image of an overwrite.
   * Over-recording is safe: rolling back a write that never happened either
   * restores identical content or unlinks a file that is not there (ENOENT
   * tolerated below). Under-recording loses user data — so mutation sites
   * record first, mutate second.
   */
  recordWrite(filePath: string, preContent: string | null): void {
    this.entries.push({
      path: filePath,
      kind: preContent === null ? "created" : "overwritten",
      preContent,
    });
  }

  /** Record a deletion BEFORE the unlink, with the full pre-image. */
  recordDelete(filePath: string, preContent: string): void {
    this.entries.push({ path: filePath, kind: "deleted", preContent });
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * Human-readable journal lines (workspace-relative), oldest first — printed
   * verbatim when a failed run must NOT roll back (--allow-dirty).
   */
  describeEntries(workspaceRoot: string): string[] {
    return this.entries.map(
      (e) => `${e.kind} ${path.relative(workspaceRoot, e.path)}`,
    );
  }

  /**
   * Replay the journal in REVERSE order: restore pre-images, unlink created
   * files. Reverse order makes repeated writes to the same path converge on
   * the OLDEST pre-image (pass-1 barrel pre-image is restored last), i.e. the
   * true pre-sync state.
   *
   * Per-entry best-effort: a failing inverse op is collected and replay
   * CONTINUES — restoring nine of ten files beats aborting at the first
   * error. The caller prints the failures; nothing here (or anywhere) falls
   * back to a git-wide reset/clean.
   *
   * Restores use a plain writeFile, not the atomic tmp+rename protocol: the
   * rollback may be running on the same broken substrate that failed the
   * sync, and the simplest possible write maximizes the odds of getting the
   * user's bytes back on disk.
   */
  async rollback(
    logger: LoggerPort,
    workspaceRoot: string,
  ): Promise<RollbackOutcome> {
    const outcome: RollbackOutcome = {
      attempted: this.entries.length,
      restored: 0,
      failures: [],
    };

    for (const entry of [...this.entries].reverse()) {
      const relative = path.relative(workspaceRoot, entry.path);
      try {
        if (entry.preContent === null) {
          // Inverse of a create: remove the file. ENOENT is fine — the write
          // may have been journaled but never performed (record-first), or a
          // later entry for the same path already restored older state.
          try {
            await fs.unlink(entry.path);
          } catch (err: unknown) {
            if (
              !(
                err instanceof Error &&
                "code" in err &&
                (err as { code?: string }).code === "ENOENT"
              )
            ) {
              throw err;
            }
          }
          logger.info(`rolled back (removed) ${relative}`);
        } else {
          // Inverse of an overwrite/delete: put the pre-image back.
          await fs.mkdir(path.dirname(entry.path), { recursive: true });
          await fs.writeFile(entry.path, entry.preContent, {
            encoding: "utf8",
          });
          logger.info(`rolled back (restored) ${relative}`);
        }
        outcome.restored += 1;
      } catch (err: unknown) {
        outcome.failures.push({
          path: entry.path,
          intended:
            entry.preContent === null
              ? "remove created file"
              : "restore pre-image",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return outcome;
  }
}
