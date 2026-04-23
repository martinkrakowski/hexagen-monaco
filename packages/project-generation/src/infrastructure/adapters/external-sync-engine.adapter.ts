import { SyncEngine, type Manifest } from "@hexagen/sync";
import type {
  ExternalProjectGeneratorPort,
  GeneratorError,
} from "../../application/ports/out/external-project-generator.port.js";
import { Project } from "../../domain/entities/project.js";
import type { Result } from "@hexagen/shared";
import fs from "node:fs/promises";
import path from "node:path";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  errorWithException: () => {},
};

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class ExternalSyncEngineAdapter implements ExternalProjectGeneratorPort {
  async generateAt(
    targetRoot: string,
    manifest: Manifest,
  ): Promise<Result<Project, GeneratorError>> {
    try {
      await fs.mkdir(targetRoot, { recursive: true });

      const engine = new SyncEngine(
        {
          dryRun: false,
          force: true,
          forceRoot: true,
          allowDirty: true,
          strict: false,
          mode: "external",
          logger: noopLogger,
        },
        { targetRoot, manifest },
      );
      await engine.run();

      const files = await this.collectFileTree(targetRoot);
      const projectName = (manifest.system as string) ?? "generated-project";
      const project = Project.create({
        id: generateId(),
        name: projectName,
        rootName: projectName.toLowerCase().replace(/\s+/g, "-"),
        files,
      });
      return { success: true, value: project };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "GENERATION_FAILED",
          message:
            err instanceof Error ? err.message : "Unknown generation error",
          cause: err,
        },
      };
    }
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
