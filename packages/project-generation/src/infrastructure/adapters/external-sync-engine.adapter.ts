import { SyncEngine, type Manifest, type SyncFlags } from "@hexagen/sync";
import type { ExternalProjectGeneratorPort } from "../../application/ports/out/external-project-generator.port.js";
import { Project } from "../../domain/entities/project.js";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export class ExternalSyncEngineAdapter implements ExternalProjectGeneratorPort {
  async generateAt(targetRoot: string, manifest: Manifest): Promise<Project> {
    await fs.mkdir(targetRoot, { recursive: true });

    const archDir = path.join(targetRoot, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    await fs.writeFile(
      path.join(archDir, "manifest.yaml"),
      yaml.dump(manifest),
      "utf8",
    );

    const flags: SyncFlags = {
      dryRun: false,
      force: true,
      forceRoot: false,
      allowDirty: true,
      strict: false,
      mode: "external",
      logger: noopLogger,
    };

    const engine = new SyncEngine(flags, {
      targetRoot,
      manifest,
    });

    await engine.run();

    const files = await this.collectFileTree(targetRoot);

    const projectName = manifest.system ?? "generated-project";
    return Project.create({
      id: crypto.randomUUID(),
      name: projectName,
      rootName: projectName.toLowerCase().replace(/\s+/g, "-"),
      files,
    });
  }

  private async collectFileTree(
    dir: string,
    base = "",
  ): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = path.join(base, entry.name);
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const subFiles = await this.collectFileTree(fullPath, relativePath);
        for (const [k, v] of subFiles) {
          files.set(k, v);
        }
      } else {
        const content = await fs.readFile(fullPath, "utf8");
        files.set(relativePath, content);
      }
    }

    return files;
  }
}
