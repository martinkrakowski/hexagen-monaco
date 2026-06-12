// migration-report.ts – simple audit logger for SyncEngine
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "./config.js";

export interface ReportEntry {
  // Open-ended audit tag, deliberately NOT a closed union (review #315):
  // generators currently record created | updated | skipped | blocked |
  // deleted | info | warn | warning | error, and the previous five-member
  // union silently laundered the rest through a cast in record(). A closed
  // vocabulary enforced at the call sites (via ReportRecorder) lands with
  // PR-B1's write journal, which reworks this interface anyway.
  type: string;
  target: string;
  message?: string;
}

export class MigrationReport {
  private entries: ReportEntry[] = [];
  record(type: string, target: string, message?: string) {
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
