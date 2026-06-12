// migration-report.ts – simple audit logger for SyncEngine
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "./config.js";

/**
 * Closed audit vocabulary (PR-B1, promised in the PR-A2 review): every tag a
 * generator may record, enforced at the call sites through ReportRecorder
 * (domain/types.ts) and at the sink through `record()` below. The previous
 * shape was an honest-but-open `string` after review #315 showed a
 * five-member union silently laundering the rest through a cast. PR-B2 (D6)
 * deleted the dead generator family (wiring, test-generator, the migration-*
 * trio) that owned every "info" recorder, and "warn" had no recorder at all —
 * both dropped here as promised; "warning" is the live spelling (eslint.ts).
 */
export type ReportEntryType =
  | "created"
  | "updated"
  | "deleted"
  | "skipped"
  | "blocked"
  | "warning"
  | "error";

export interface ReportEntry {
  type: ReportEntryType;
  target: string;
  message?: string;
}

export class MigrationReport {
  private entries: ReportEntry[] = [];
  record(type: ReportEntryType, target: string, message?: string) {
    this.entries.push({ type, target, message });
  }
  async writeReport(config: SyncConfig) {
    // PR-A2 (RCA #3): --dry-run must not write the report file — it was the
    // one unconditional write left in a "preview" run. The summary goes to the
    // logger instead; an explicit `--report <path>` opts back into writing it
    // (useful for diffing previews). Real runs keep writing the default
    // SYNC-MIGRATION-REPORT.md (decision D5: the audit trail stays opt-out).
    if (config.dryRun && !config.report) {
      const counts = new Map<string, number>();
      for (const e of this.entries) {
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      }
      const breakdown = [...counts.entries()]
        .map(([type, n]) => `${n} ${type}`)
        .join(", ");
      config.logger.info(
        `[DRY-RUN] skipping migration report file (${this.entries.length} entries${
          breakdown ? `: ${breakdown}` : ""
        }) — pass --report <path> to write it anyway`,
      );
      return;
    }
    // `--report` is resolved against the workspace root, but absolute paths
    // (and `..`) are deliberately honored — `--report /tmp/preview.md` is the
    // sensible way to keep a dry-run preview out of the tree entirely. This is
    // the operator's own CLI flag on a local tool (the external adapter never
    // sets it), so it carries the same trust as shell redirection; the
    // containment checks in apps.ts guard MANIFEST-derived paths, which are a
    // different trust level.
    const reportPath = config.report
      ? path.resolve(config.workspaceRoot, config.report)
      : path.join(config.workspaceRoot, "SYNC-MIGRATION-REPORT.md");
    // A nested destination (e.g. --report reports/preview.md) needs its parent
    // to exist — createWriteStream does not mkdir (review #315). Unconditional
    // on purpose: this line is only reached when a write was requested (real
    // run, or explicit --report opt-in under dry-run).
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    // PR-B1 (RCA #4): `flags: "w"` truncates a previous run's report, so this
    // is a mutation site like any other — journal the pre-image first. Only
    // replayed if THIS write fails mid-stream (the report is the run's last
    // op); a dry-run --report opt-in records too but is never replayed
    // (rollback is gated on !dryRun in the engine).
    let preContent: string | null = null;
    try {
      preContent = await fs.readFile(reportPath, "utf8");
    } catch (e: unknown) {
      if (
        !(
          e instanceof Error &&
          "code" in e &&
          (e as { code?: string }).code === "ENOENT"
        )
      )
        throw e;
    }
    config.journal?.recordWrite(reportPath, preContent);
    const stream = createWriteStream(reportPath, { flags: "w" });
    // PR-A2: previously this fired stream.end() and returned — the process (or
    // a test assertion) could outrun the flush. The error handler is attached
    // before the first write so open failures (EACCES, EISDIR, …) reject
    // instead of crashing the process; resolve rides the stream's own finish.
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.write("# Sync Migration Report\n\n");
      for (const e of this.entries) {
        stream.write(
          `- ${e.type.toUpperCase()}: ${e.target}${e.message ? ` – ${e.message}` : ""}\n`,
        );
      }
      stream.end(resolve);
    });
  }
}
