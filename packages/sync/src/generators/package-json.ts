import path from "node:path";
import fs from "node:fs/promises";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import type { Manifest } from "../types/manifest.js";

/**
 * Generates or updates package.json with merge strategy.
 * Preserves protected keys from existing file.
 * Uses safeWriteFile with skipGeneratedCheck=true (package.json can't carry marker).
 */
export async function generatePackageJson(
  modulePath: string,
  moduleName: string,
  config: SyncConfig,
  report?: { record: (type: string, target: string, message?: string) => void },
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const defaults = config.manifest?.workspaceDefaults?.packageJson ?? {};
  const moduleOverrides =
    config.manifest?.bounded_contexts?.find(
      (m): m is NonNullable<Manifest["bounded_contexts"]>[number] =>
        m.name === moduleName,
    )?.packageJson ?? {};

  const pkgPath = path.join(modulePath, "package.json");

  const desiredPkg: Record<string, unknown> = {
    name: `@hexagen/${moduleName}`,
    version: "0.1.0",
    private: true,
    type: "module",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    scripts: {
      build: "tsc",
      lint: "eslint . --ext .ts,.tsx",
      typecheck: "tsc --noEmit",
      ...((defaults.scripts as Record<string, string>) ?? {}),
      ...((moduleOverrides.scripts as Record<string, string>) ?? {}),
    },
    dependencies: {
      ...((defaults.dependencies as Record<string, string>) ?? {}),
      ...((moduleOverrides.dependencies as Record<string, string>) ?? {}),
    },
    devDependencies: {
      typescript: "^5.0.0",
      ...((defaults.devDependencies as Record<string, string>) ?? {}),
      ...((moduleOverrides.devDependencies as Record<string, string>) ?? {}),
    },
  };

  // Read current if exists
  let currentPkg: Record<string, unknown> = {};
  try {
    const currentContent = await fs.readFile(pkgPath, "utf8");
    currentPkg = JSON.parse(currentContent) as Record<string, unknown>;
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) {
      throw e;
    }
  }

  const protectedKeys = config.manifest?.generator?.sync?.packageJson
    ?.protectedKeys ?? [
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

  // Merge: preserve protected keys from current, inject missing, overwrite unprotected
  const mergedPkg: Record<string, unknown> = { ...currentPkg };

  for (const [key, value] of Object.entries(desiredPkg)) {
    if (protectedKeys.includes(key)) {
      if (!(key in currentPkg)) {
        mergedPkg[key] = value;
      }
    } else {
      mergedPkg[key] = value;
    }
  }

  const mergedContent = JSON.stringify(mergedPkg, null, 2) + "\n";

  // Bypass generated-file check (package.json can't carry marker)
  const status = await safeWriteFileAtomic(
    pkgPath,
    mergedContent,
    config,
    report,
    true,
  );

  if (status === "created") result.created.push(pkgPath);
  if (status === "updated") result.updated.push(pkgPath);
  if (status === "skipped" || status === "protected")
    result.skipped.push(pkgPath);
  result.totalOps += status === "created" || status === "updated" ? 1 : 0;

  return result;
}
