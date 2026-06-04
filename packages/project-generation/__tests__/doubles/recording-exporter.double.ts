import fs from "node:fs/promises";
import path from "node:path";
import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "../../src/application/ports/out/project-exporter.port.js";

/**
 * Exporter double that captures the on-disk project tree at export time — i.e.
 * AFTER the use case has written add-on files into the temp dir and BEFORE its
 * `finally` cleanup removes it. Lets a test assert the temp-dir merge actually
 * reached disk (what the real ZIP / GitHub exporters read), not just the
 * in-memory `project.files`.
 */
export class RecordingExporterDouble implements ProjectExporterPort {
  private captured = new Map<string, string>();
  private exportedConfigs: Array<{ sourceDir: string; config: ExportConfig }> =
    [];

  getCapturedFiles(): Map<string, string> {
    return new Map(this.captured);
  }

  getExportedConfigs(): Array<{ sourceDir: string; config: ExportConfig }> {
    return [...this.exportedConfigs];
  }

  getCallCount(): number {
    return this.exportedConfigs.length;
  }

  async export(
    sourceDirectory: string,
    config: ExportConfig,
  ): Promise<ExportResult> {
    this.exportedConfigs.push({ sourceDir: sourceDirectory, config });
    this.captured = new Map();
    // The generator double doesn't create the temp dir; tolerate its absence
    // (an empty capture) when no add-on files were written.
    await this.walk(sourceDirectory, sourceDirectory).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      },
    );
    return { success: true, destinationUrl: `${sourceDirectory}/project.zip` };
  }

  private async walk(dir: string, base: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, base);
      } else {
        const rel = path.relative(base, full).split(path.sep).join("/");
        this.captured.set(rel, await fs.readFile(full, "utf-8"));
      }
    }
  }
}
