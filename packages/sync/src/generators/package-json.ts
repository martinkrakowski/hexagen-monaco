import path from "node:path";
import fs from "node:fs/promises";
import { SyncConfig } from "../config.js";
import type { ReportRecorder } from "../domain/types.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { isInScope, safeWriteFileAtomic } from "../fs-utils.js";
import {
  expandDependsOn,
  resolveScope,
  type Manifest,
} from "../types/manifest.js";

/**
 * Generates or updates package.json with merge strategy.
 * Preserves protected keys from existing file.
 * Uses safeWriteFile with skipGeneratedCheck=true (package.json can't carry marker).
 */
export async function generatePackageJson(
  modulePath: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  // Workspace defaults are canonically nested under `monorepo.workspaceDefaults`
  // (where wizard-to-manifest writes them) but a legacy root-level
  // `workspaceDefaults` is also supported. Root wins — the same dual-location
  // read tsconfig.ts's resolveWorkspaceTemplate and eslint.ts use; reading only
  // the root level silently dropped every wizard-declared script/devDependency
  // from generated package.json files (F8).
  const defaults =
    config.manifest?.workspaceDefaults?.packageJson ??
    config.manifest?.monorepo?.workspaceDefaults?.packageJson ??
    {};
  const context = config.manifest?.bounded_contexts?.find(
    (m): m is NonNullable<Manifest["bounded_contexts"]>[number] =>
      m.name === moduleName,
  );
  const moduleOverrides = context?.packageJson ?? {};
  // The project's own npm scope (@{scope}/<pkg>) — distinct from the @hexagen
  // tooling devDeps. Falls back scope → system → "generated-project".
  const scope = config.manifest
    ? resolveScope(config.manifest)
    : "generated-project";
  const dependsOnDeps = context ? expandDependsOn(context, scope) : {};

  const pkgPath = path.join(modulePath, "package.json");

  const dependencies: Record<string, string> = {
    ...dependsOnDeps,
    ...((defaults.dependencies as Record<string, string>) ?? {}),
    ...((moduleOverrides.dependencies as Record<string, string>) ?? {}),
  };

  const desiredPkg: Record<string, unknown> = {
    name: `@${scope}/${moduleName}`,
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
      lint: "eslint . --ext .ts,.tsx",
      typecheck: "tsc --noEmit",
      // Vitest runner (ADR-0044), scaffolded only for *external* (generated)
      // projects — paired with the vitest.config.ts emitted below. This repo's
      // own packages (self-regen) keep their shared-base setup untouched.
      // `--passWithNoTests` so a freshly scaffolded module passes before any test
      // is written.
      ...(config.mode === "external"
        ? { test: "vitest run --passWithNoTests" }
        : {}),
      ...((defaults.scripts as Record<string, string>) ?? {}),
      ...((moduleOverrides.scripts as Record<string, string>) ?? {}),
    },
    // Emitted only when non-empty (PR-B2, capstone 6f): Yarn 4 deletes an
    // empty `"dependencies": {}` from workspace manifests during install, so
    // emitting one creates a permanent install↔sync churn loop — install
    // strips the key, the next sync re-injects it (`dependencies` is
    // protected, but a protected key MISSING from the current file is
    // re-added), and the tree never converges across the consumer's
    // sync → install → sync workflow. A dependency-less package carries no
    // block at all, matching yarn's normalized form. Existing trees that
    // still carry `{}` on disk stay untouched via the protected-key merge.
    // devDependencies/scripts can't go empty (both have built-in entries).
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
    devDependencies: {
      typescript: "^5.0.0",
      ...(config.mode === "external" ? { vitest: "^4.1.9" } : {}),
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

  recordWriteStatus(result, pkgPath, status);

  // Scaffold a per-package vitest.config.ts for *external* (generated) projects,
  // written once (never overwritten — it becomes the project owner's file after
  // creation). Generated projects use moduleResolution:bundler, so no `.js`→`.ts`
  // extensionAlias is needed; the critical setting is excluding dist/** — Vitest
  // 4's default exclude is only node_modules/.git, so without it a bare
  // `vitest run` would also run the compiled tests in dist/. This repo's own
  // packages (self-regen) keep their shared-base configs and are never touched.
  //
  // Mirrors writeStubFile (stubs.ts) — the same write-once-under-scope idiom:
  //   1. isInScope BEFORE any disk read, so an out-of-scope `--only` target
  //      produces zero filesystem side effects (the contract isInScope exists
  //      to honour; safeWriteFileAtomic re-checks it for the write itself).
  //   2. An explicit stat that PRESERVES an existing file. This is load-bearing,
  //      not redundant: external mode runs with forceRoot, which *bypasses*
  //      safeWriteFileAtomic's hand-written-file guard — so the stat, not the
  //      guard, is what makes this write-once across regenerations.
  //   3. skipGeneratedCheck=false (vitest.config.ts is the owner's hand-written
  //      file, not a marker-bearing managed one like package.json).
  if (config.mode === "external") {
    const vitestConfigPath = path.join(modulePath, "vitest.config.ts");
    if (isInScope(vitestConfigPath, config)) {
      let vitestConfigExists = false;
      try {
        await fs.stat(vitestConfigPath);
        vitestConfigExists = true;
      } catch (e) {
        // ENOENT = absent (the write-if-absent happy path). Any other error
        // (EACCES, ELOOP, …) is a real fault — surface it rather than silently
        // scaffolding over an unreadable path.
        if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) {
          throw e;
        }
      }
      if (!vitestConfigExists) {
        const vitestConfigContent =
          `import { defineConfig } from "vitest/config";\n\n` +
          `export default defineConfig({\n` +
          `  test: {\n` +
          `    environment: "node",\n` +
          `    exclude: ["**/node_modules/**", "**/dist/**"],\n` +
          `  },\n` +
          `});\n`;
        const vitestStatus = await safeWriteFileAtomic(
          vitestConfigPath,
          vitestConfigContent,
          config,
          report,
          false,
        );
        recordWriteStatus(result, vitestConfigPath, vitestStatus);
      }
    }
  }

  return result;
}
