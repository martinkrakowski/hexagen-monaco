import { SyncEngine, type Manifest } from "@hexagen/sync";
import type {
  ExternalProjectGeneratorPort,
  GeneratorError,
} from "../../application/ports/out/external-project-generator.port.js";
import type { GenerationManifest } from "../../application/generation-manifest.js";
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
    manifest: GenerationManifest,
  ): Promise<Result<Project, GeneratorError>> {
    try {
      await fs.mkdir(targetRoot, { recursive: true });

      // The one place the engine's manifest dialect is named (HEX-004). This is
      // an assignment, not a cast, and that is the point: it is the compile-time
      // proof that the context-owned `GenerationManifest` is still something the
      // engine accepts. Turning it into `as Manifest` would silence exactly the
      // drift this boundary exists to catch.
      const engineManifest: Manifest = manifest;

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
        { targetRoot, manifest: engineManifest },
      );
      const summary = await engine.run();
      // Failed-soft generators (caught into result.error, e.g. tsconfig/apps)
      // do not throw — run() RESOLVES with summary.errors > 0 (sync PR-B2
      // review, B-1). Without this check the wizard returned success over a
      // partial tree; the catch below only sees thrown failures.
      if (summary.errors > 0) {
        return {
          success: false,
          error: {
            code: "GENERATION_FAILED",
            message: `external sync completed with ${summary.errors} generator failure(s) — generated tree is incomplete`,
          },
        };
      }

      const files = await this.collectFileTree(targetRoot);
      // No cast: `system` is a declared `string | undefined` on the DTO, so the
      // fallback is the only narrowing needed. An `as string` here would also
      // suppress the type error if the field's shape ever changed.
      const projectName = manifest.system ?? "generated-project";
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
      // Normalize to forward slashes so keys match the materializer's posix
      // paths (and stay stable on Windows) — the bundle generator does the same.
      const relativePath = path
        .join(base, entry.name)
        .split(path.sep)
        .join("/");
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
