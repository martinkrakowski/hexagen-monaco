import fs from "node:fs/promises";

import path from "node:path";
// Simple atomic write implementation (no external sync import)

// Minimal SyncConfig shape used for logging; we avoid importing the full type to keep the package independent.
type SyncConfig = {
  logger?: { info: (msg: string) => void };
};

/**
 * WorkflowGenerator writes the sync‑integrity GitHub Actions workflow into a generated project.
 * It reads a template file bundled with the generator and performs an atomic write.
 */
export class WorkflowGenerator {
  /**
   * @param templatePath Absolute path to the workflow template file.
   */
  constructor(private readonly templatePath: string) {}

  /**
   * Generates the workflow file inside the given project root.
   * @param projectRoot Absolute path to the generated project root.
   * @param config Sync configuration used for safeWriteFileAtomic (dryRun, force, logger, workspaceRoot).
   */
  async generate(projectRoot: string, config: SyncConfig): Promise<void> {
    // Resolve destination path
    const dest = path.join(
      projectRoot,
      ".github",
      "workflows",
      "sync-integrity.yml",
    );

    // Load template content
    const template = await fs.readFile(this.templatePath, "utf8");

    // Perform atomic write using the shared utility
    // Atomic write: write to temp then rename
    const tmpPath = `${dest}.tmp.${Date.now()}`;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(tmpPath, template, { encoding: "utf8" });
    await fs.rename(tmpPath, dest);
    if (config?.logger?.info) {
      config.logger.info(`created ${dest}`);
    }
  }
}
