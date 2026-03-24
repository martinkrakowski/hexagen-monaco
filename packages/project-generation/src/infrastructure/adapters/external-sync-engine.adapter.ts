import { SyncEngine, type Manifest, type SyncFlags } from "@hexagen/sync";
import type {
  ExternalProjectGeneratorPort,
  GeneratorError,
} from "../../application/ports/out/external-project-generator.port.js";
import { Project } from "../../domain/entities/project.js";
import type { Result } from "@hexagen/shared";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  generateRootPackageJson,
  generateRootTsConfig,
  generateRootTurboJson,
  generateStubContent,
  generateAppStubContent,
} from "./root-files.js";

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

      const archDir = path.join(targetRoot, ".architecture");
      await fs.mkdir(archDir, { recursive: true });
      await fs.writeFile(
        path.join(archDir, "manifest.yaml"),
        yaml.dump(manifest),
        "utf8",
      );

      // Create root files before engine runs
      await this.createRootFiles(targetRoot, manifest);

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

      // Create app folders and stubs
      await this.createAppFiles(targetRoot, manifest);

      // Create stub files after engine runs (directories now exist)
      await this.createStubFiles(targetRoot, manifest);

      const files = await this.collectFileTree(targetRoot);

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

  private async createRootFiles(
    targetRoot: string,
    manifest: Record<string, unknown>,
  ): Promise<void> {
    const systemName = (manifest.system as string) || "hexagen-project";
    await fs.writeFile(
      path.join(targetRoot, "package.json"),
      generateRootPackageJson(systemName),
    );
    await fs.writeFile(
      path.join(targetRoot, "tsconfig.base.json"),
      generateRootTsConfig(),
    );
    await fs.writeFile(
      path.join(targetRoot, "turbo.json"),
      generateRootTurboJson(),
    );
  }

  private async createStubFiles(
    targetRoot: string,
    manifest: Record<string, unknown>,
  ): Promise<void> {
    const contexts = manifest.bounded_contexts as
      | Array<Record<string, unknown>>
      | undefined;
    if (!contexts) return;

    for (const bc of contexts) {
      const bcName = bc.name as string;
      const bcPath = path.join(targetRoot, "packages", bcName, "src");
      const layers = bc.layers as Record<string, unknown> | undefined;

      const inPorts = (layers?.application as Record<string, unknown>)
        ?.ports as Record<string, string[]> | undefined;
      const outPorts = (layers?.application as Record<string, unknown>)
        ?.ports as Record<string, string[]> | undefined;
      const adapters = (layers?.infrastructure as Record<string, unknown>)
        ?.adapters as string[] | undefined;
      const useCases = (layers?.application as Record<string, unknown>)
        ?.use_cases as string[] | undefined;
      const entities = (layers?.domain as Record<string, unknown>)?.entities as
        | string[]
        | undefined;
      const valueObjects = (layers?.domain as Record<string, unknown>)
        ?.value_objects as string[] | undefined;

      const writeStub = async (subPath: string, fileName: string) => {
        try {
          const fullDir = path.join(bcPath, subPath);
          await fs.mkdir(fullDir, { recursive: true });
          const finalName = fileName.endsWith(".ts")
            ? fileName
            : `${fileName}.ts`;
          await fs.writeFile(
            path.join(fullDir, finalName),
            generateStubContent(finalName),
          );
        } catch {
          // Directory may not exist if SyncEngine didn't create it — skip silently
        }
      };

      for (const p of inPorts?.in || [])
        await writeStub("application/ports/in", p);
      for (const p of outPorts?.out || [])
        await writeStub("application/ports/out", p);
      for (const a of adapters || [])
        await writeStub("infrastructure/adapters", a);
      for (const uc of useCases || [])
        await writeStub("application/use-cases", uc);
      for (const e of entities || []) await writeStub("domain/entities", e);
      for (const vo of valueObjects || [])
        await writeStub("domain/value_objects", vo);
    }
  }

  private async createAppFiles(
    targetRoot: string,
    manifest: Record<string, unknown>,
  ): Promise<void> {
    const contexts = manifest.bounded_contexts as
      | Array<Record<string, unknown>>
      | undefined;
    if (!contexts) return;

    // Determine which apps to generate based on framework selections
    const appTypes = new Set<string>();
    for (const bc of contexts) {
      const uiFramework = bc.uiFramework as string | undefined;
      const apiFramework = bc.apiFramework as string | undefined;
      if (uiFramework && uiFramework !== "None") appTypes.add("web");
      if (apiFramework && apiFramework !== "plain-ts") appTypes.add("api");
    }

    for (const appType of appTypes) {
      const appDir = path.join(targetRoot, "apps", appType);
      await fs.mkdir(appDir, { recursive: true });
      await fs.mkdir(path.join(appDir, "src"), { recursive: true });

      // Generate app package.json
      const appPackageJson = {
        name: `@${manifest.system}/${appType}`,
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: {
          build: appType === "web" ? "next build" : "tsc",
          dev: appType === "web" ? "next dev" : "tsc --watch",
          lint: "eslint src --ext .ts,.tsx",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          ...(appType === "web"
            ? { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" }
            : { fastify: "^5.0.0" }),
        },
        devDependencies: {
          typescript: "^5.5.4",
          eslint: "^9.0.0",
          "@typescript-eslint/parser": "^8.0.0",
          "@typescript-eslint/eslint-plugin": "^8.0.0",
        },
      };
      await fs.writeFile(
        path.join(appDir, "package.json"),
        JSON.stringify(appPackageJson, null, 2),
      );

      // Generate app tsconfig.json
      const appTsConfig = {
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          rootDir: "src",
          outDir: "dist",
          composite: true,
          declaration: true,
          emitDeclarationOnly: true,
          jsx: appType === "web" ? "react-jsx" : "preserve",
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      };
      await fs.writeFile(
        path.join(appDir, "tsconfig.json"),
        JSON.stringify(appTsConfig, null, 2),
      );

      // Generate app entry point
      const systemName = (manifest.system as string) || "project";
      await fs.writeFile(
        path.join(appDir, "src", "index.ts"),
        generateAppStubContent(systemName, appType),
      );
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
