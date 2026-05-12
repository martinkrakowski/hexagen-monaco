import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Manifest } from "../../src/types/manifest.js";

export const WORKSPACE_TSCONFIG = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: true,
    composite: true,
    tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
    paths: {},
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", ".turbo"],
  references: [] as Array<{ path: string }>,
};

export const LAYERS_TEMPLATE = {
  domain: { folder: "src/domain" },
  application: {
    folder: "src/application",
    subfolders: ["ports/in", "ports/out", "use-cases"],
  },
  infrastructure: {
    folder: "src/infrastructure",
    subfolders: ["adapters"],
  },
};

export const PROTECTED_KEYS = [
  "private",
  "version",
  "license",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "main",
  "module",
  "types",
  "exports",
  "bin",
];

export async function createFixture(
  boundedContextNames: string[],
  prefix = "hexagen-sync-fixture-",
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      { name: "fixture-monorepo", private: true, workspaces: ["packages/*"] },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await fs.writeFile(
    path.join(root, "tsconfig.base.json"),
    JSON.stringify({}, null, 2) + "\n",
    "utf8",
  );

  for (const name of boundedContextNames) {
    await fs.mkdir(path.join(root, "packages", name), { recursive: true });
  }

  return root;
}

export async function createEmptyFixture(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-sync-idempotency-empty-"));
}

export async function removeFixture(root: string | null): Promise<void> {
  if (!root) return;
  await fs.rm(root, { recursive: true, force: true });
}

export function makeValidManifest(
  contexts: Manifest["bounded_contexts"],
): Manifest {
  return {
    description: "Test manifest",
    workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
    generator: {
      sync: {
        layers: LAYERS_TEMPLATE,
        packageJson: { protectedKeys: PROTECTED_KEYS },
      },
    },
    bounded_contexts: contexts,
  };
}

export interface FileSnapshot {
  relPath: string;
  sha256: string;
}

export async function snapshotTree(root: string): Promise<FileSnapshot[]> {
  const results: FileSnapshot[] = [];
  const skip = new Set(["node_modules", ".git", ".turbo", "dist"]);

  async function walk(currentDir: string, relDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const absPath = path.join(currentDir, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
      } else if (entry.isFile()) {
        const content = await fs.readFile(absPath);
        const sha256 = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
        results.push({ relPath, sha256 });
      }
    }
  }

  await walk(root, "");
  results.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return results;
}
