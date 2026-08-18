import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";
import type { Result } from "@hexagen/shared";
import type { ArchitectureQueryPort } from "../../application/ports/out/sync-engine.port.js";
import type {
  CreateAdapterCommand,
  CreatePortCommand,
  ScaffoldModuleCommand,
  ScaffoldingPort,
} from "../../application/ports/out/scaffolding.port.js";
import { readManifestDocument } from "./manifest-io.js";

const execAsync = promisify(exec);

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .toLowerCase();
}

function isStrictDescendant(rootReal: string, candidate: string): boolean {
  return candidate.startsWith(rootReal + path.sep);
}

async function resolveInsideWorkspace(
  workspaceRoot: string,
  relativePath: string,
): Promise<string | null> {
  const trimmed = relativePath.trim();
  if (!trimmed || path.isAbsolute(trimmed)) return null;
  let rootReal: string;
  try {
    rootReal = await fs.realpath(workspaceRoot);
  } catch {
    return null;
  }
  const lexical = path.resolve(rootReal, trimmed);
  if (!isStrictDescendant(rootReal, lexical)) return null;

  // Physical parent: `link/file.ts` must not delete a target outside
  // the workspace when `link` is a symlink.
  const parent = path.dirname(lexical);
  let parentReal: string;
  try {
    parentReal = await fs.realpath(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return lexical;
    return null;
  }
  if (parentReal !== rootReal && !isStrictDescendant(rootReal, parentReal)) {
    return null;
  }
  const candidate = path.join(parentReal, path.basename(lexical));
  try {
    const fileReal = await fs.realpath(candidate);
    if (!isStrictDescendant(rootReal, fileReal)) return null;
    return fileReal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
    return null;
  }
}

export class SyncEngineAdapter
  implements ArchitectureQueryPort, ScaffoldingPort
{
  constructor(private readonly workspaceRoot: string) {}

  async getArchitectureGraph(): Promise<Result<ArchitectureGraph>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const names = new Set(contexts.map((context) => context.name));

      const nodes: ArchitectureGraph["nodes"] = contexts.map((context) => ({
        id: context.name,
        label: context.name,
        type: context.type ?? "supporting",
        status: "active",
      }));

      const edges: ArchitectureGraph["edges"] = [];
      for (const context of contexts) {
        for (const target of context.depends_on ?? []) {
          edges.push({
            source: context.name,
            target,
            relationship: "depends_on",
            isValid: names.has(target),
            violationReason: names.has(target)
              ? undefined
              : `Target module not found: ${target}`,
          });
        }
      }

      return {
        success: true,
        value: {
          nodes,
          edges,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async getLinterReport(): Promise<Result<LinterReport>> {
    try {
      let valid = true;
      let errors: string[] = [];

      try {
        await execAsync("yarn lint:arch", {
          cwd: this.workspaceRoot,
          timeout: 30_000,
        });
      } catch (error) {
        valid = false;
        const err = error as Error & {
          stderr?: string | Buffer;
          code?: string;
        };
        if (err.code === "ENOENT") {
          errors = ["yarn executable not found on PATH"];
        } else {
          const message = err.stderr ? String(err.stderr) : err.message;
          errors = message
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        }
      }

      const violations = errors.map((message) => ({
        ruleId: "arch-lint",
        severity: "error" as const,
        file: ".architecture/manifest.yaml",
        message,
      }));

      return {
        success: true,
        value: {
          timestamp: new Date().toISOString(),
          isCompliant: valid,
          violations,
          scannedFilesCount: 1,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async scaffoldModule(
    command: ScaffoldModuleCommand,
  ): Promise<Result<{ filesCreated: string[] }>> {
    try {
      const packageRoot = path.join(
        this.workspaceRoot,
        "packages",
        command.name,
      );
      const srcRoot = path.join(packageRoot, "src");
      const layerRoot = path.join(srcRoot, command.layer);

      const layerSubdirs: Record<typeof command.layer, string[]> = {
        domain: ["entities", "value-objects", "ports"],
        application: ["use-cases", "ports", "factories"],
        infrastructure: ["adapters", "services"],
      };

      await fs.mkdir(layerRoot, { recursive: true });
      for (const subdir of layerSubdirs[command.layer]) {
        await fs.mkdir(path.join(layerRoot, subdir), { recursive: true });
      }

      const packageJsonPath = path.join(packageRoot, "package.json");
      const tsconfigPath = path.join(packageRoot, "tsconfig.json");
      const indexPath = path.join(srcRoot, "index.ts");

      const packageJsonContent = {
        name: `@hexagen/${command.name}`,
        version: "0.1.0",
        private: true,
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            default: "./dist/index.js",
          },
        },
        scripts: {
          build: "tsc",
          lint: "eslint . --ext .ts",
          typecheck: "tsc --noEmit",
        },
      };

      const tsconfigContent = {
        extends: "../../tsconfig.base.json",
        compilerOptions: {
          rootDir: "src",
          outDir: "dist",
          declaration: true,
          emitDeclarationOnly: true,
          composite: true,
          tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
          paths: {},
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"],
      };

      const filesCreated: string[] = [];

      const fileExists = async (p: string): Promise<boolean> => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      };

      if (!(await fileExists(packageJsonPath))) {
        await fs.writeFile(
          packageJsonPath,
          JSON.stringify(packageJsonContent, null, 2) + "\n",
          "utf-8",
        );
        filesCreated.push(path.relative(this.workspaceRoot, packageJsonPath));
      }

      if (!(await fileExists(tsconfigPath))) {
        await fs.writeFile(
          tsconfigPath,
          JSON.stringify(tsconfigContent, null, 2) + "\n",
          "utf-8",
        );
        filesCreated.push(path.relative(this.workspaceRoot, tsconfigPath));
      }

      if (!(await fileExists(indexPath))) {
        await fs.writeFile(
          indexPath,
          `export * from "./${command.layer}/index.js";\n`,
          "utf-8",
        );
        filesCreated.push(path.relative(this.workspaceRoot, indexPath));
      }

      const layerIndexPath = path.join(layerRoot, "index.ts");
      if (!(await fileExists(layerIndexPath))) {
        const subdirs = layerSubdirs[command.layer];
        const exports = subdirs
          .map((subdir) => {
            const relPath = `./${subdir}/index.js`;
            return `export * from "${relPath}";`;
          })
          .join("\n");
        await fs.writeFile(
          layerIndexPath,
          `// @generated by @hexagen/sync\n${exports}\n`,
          "utf-8",
        );
        filesCreated.push(path.relative(this.workspaceRoot, layerIndexPath));
      }

      return {
        success: true,
        value: { filesCreated },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async createPort(
    command: CreatePortCommand,
  ): Promise<Result<{ fileCreated: string }>> {
    try {
      const portRoot = path.join(
        this.workspaceRoot,
        "packages",
        command.domainName,
        "src",
        "application",
        "ports",
        command.type === "inbound" ? "in" : "out",
      );
      await fs.mkdir(portRoot, { recursive: true });

      const fileName = `${toKebabCase(command.portName)}.port.ts`;
      const filePath = path.join(portRoot, fileName);
      const direction = command.type === "inbound" ? "input" : "output";

      await fs.writeFile(
        filePath,
        `export interface ${command.portName} {\n  execute(${direction}: unknown): Promise<unknown>;\n}\n`,
        "utf-8",
      );

      return {
        success: true,
        value: {
          fileCreated: path.relative(this.workspaceRoot, filePath),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async createAdapter(
    command: CreateAdapterCommand,
  ): Promise<Result<{ fileCreated: string }>> {
    try {
      const adapterRoot = path.join(
        this.workspaceRoot,
        "packages",
        command.infrastructureName,
        "src",
        "infrastructure",
        "adapters",
      );
      await fs.mkdir(adapterRoot, { recursive: true });

      const fileName = `${toKebabCase(command.portName)}.adapter.ts`;
      const filePath = path.join(adapterRoot, fileName);

      await fs.writeFile(
        filePath,
        `export class ${command.portName.replace(/Port$/, "")}Adapter {\n  async execute(input: unknown): Promise<unknown> {\n    return input;\n  }\n}\n`,
        "utf-8",
      );

      return {
        success: true,
        value: {
          fileCreated: path.relative(this.workspaceRoot, filePath),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async deleteCreatedFiles(
    paths: string[],
  ): Promise<Result<{ deleted: string[] }>> {
    try {
      const resolved: { rel: string; abs: string }[] = [];
      for (const rel of paths) {
        const abs = await resolveInsideWorkspace(this.workspaceRoot, rel);
        if (!abs) {
          return {
            success: false,
            error: new Error(
              `Refusing to delete path outside workspace: ${rel}`,
            ),
          };
        }
        resolved.push({ rel, abs });
      }
      const deleted: string[] = [];
      for (const { rel, abs } of resolved) {
        try {
          await fs.unlink(abs);
          deleted.push(rel);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") throw error;
        }
      }
      return { success: true, value: { deleted } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
