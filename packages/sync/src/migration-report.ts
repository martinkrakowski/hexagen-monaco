// migration-report.ts – simple audit logger for SyncEngine
import { createWriteStream } from "node:fs";
import path from "node:path";
import type { SyncConfig } from "./config.js";

export interface ReportEntry {
  // "deleted" is recorded by reap.ts (empty-folder reaping); it was always
  // accepted at runtime via the `as any` in record() — named here for honesty.
  type: "created" | "updated" | "skipped" | "blocked" | "deleted";
  target: string;
  message?: string;
}

export class MigrationReport {
  private entries: ReportEntry[] = [];
  record(type: string, target: string, message?: string) {
    this.entries.push({ type: type as ReportEntry["type"], target, message });
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
    const reportPath = config.report
      ? path.resolve(config.workspaceRoot, config.report)
      : path.join(config.workspaceRoot, "SYNC-MIGRATION-REPORT.md");
    const stream = createWriteStream(reportPath, { flags: "w" });
    stream.write("# Sync Migration Report\n\n");
    for (const e of this.entries) {
      stream.write(
        `- ${e.type.toUpperCase()}: ${e.target}${e.message ? ` – ${e.message}` : ""}\n`,
      );
    }
    // PR-A2: previously this fired stream.end() and returned — the process (or
    // a test assertion) could outrun the flush. Resolve on the stream's own
    // finish, reject on its error.
    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      stream.end(resolve);
    });
  }
}
