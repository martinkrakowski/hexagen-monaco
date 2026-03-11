// migration-report.ts – simple audit logger for SyncEngine
import { createWriteStream } from "node:fs";
import path from "node:path";
import type { SyncConfig } from "./config.js";

export interface ReportEntry {
  type: "created" | "updated" | "skipped" | "blocked";
  target: string;
  message?: string;
}

export class MigrationReport {
  private entries: ReportEntry[] = [];
  record(type: string, target: string, message?: string) {
    this.entries.push({ type: type as any, target, message });
  }
  async writeReport(config: SyncConfig) {
    const reportPath = path.join(
      config.workspaceRoot,
      "SYNC-MIGRATION-REPORT.md",
    );
    const stream = createWriteStream(reportPath, { flags: "w" });
    stream.write("# Sync Migration Report\n\n");
    for (const e of this.entries) {
      stream.write(
        `- ${e.type.toUpperCase()}: ${e.target}${e.message ? ` – ${e.message}` : ""}\n`,
      );
    }
    stream.end();
  }
}
