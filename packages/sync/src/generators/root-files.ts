// root-files.ts – generator for monorepo-root files (package.json,
// tsconfig.base.json, turbo.json).
//
// Part of Wave 2b of the `sync-engine-unified-scaffolding` plan (Phase 2).
// Replaces the hardcoded root-file templates currently living in
// `packages/project-generation/src/infrastructure/adapters/root-files.ts`.
// Templates are sourced from `monorepo.rootFiles.*.template` in the manifest;
// when a template is absent we fall back to a built-in string that — after
// interpolation — is byte-identical to what the legacy adapter produced.
//
// Protection semantics: the three root files are all listed in
// `protectedFiles` in `fs-utils.ts`. `safeWriteFileAtomic` therefore returns
// `"protected"` on self-regen (unless `--force-root`). On external mode
// against an empty target, they are created fresh.
//
// JSON files cannot carry the `@generated` marker, so we pass
// `skipGeneratedCheck=true` to `safeWriteFileAtomic`. Root-level protection
// guards against accidental overwrites in self-regen; in external mode the
// adapter sets `forceRoot: true` so fresh writes succeed.

import path from "node:path";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { interpolate } from "../template-engine.js";
import type { Manifest } from "../types/manifest.js";

type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};

// -----------------------------------------------------------------------------
// Built-in fallback templates
// -----------------------------------------------------------------------------
//
// These mirror the JSON output of the legacy adapter's functions:
//   - generateRootPackageJson(systemName)
//   - generateRootTsConfig()
//   - generateRootTurboJson()
//
// Hard-coded variable substitutions have been replaced with `{name}`-style
// placeholders so the template engine performs the substitution uniformly.
// After interpolation with the same inputs, output is byte-identical to the
// legacy adapter (verified against systemName="test-project",
// packageManager="yarn@4.12.0", workspaces=["apps/*","packages/*"]).
//
// IMPORTANT: No trailing newline — `JSON.stringify(obj, null, 2)` does not
// append one. Preserving byte-identity means the generator must not add one
// either. This deliberately differs from `tsconfig.ts` (per-package), which
// does append `"\n"` at the per-package level.

/**
 * Built-in fallback for `package.json` at the monorepo root.
 *
 * Placeholders:
 *   - `{system}`         — system name (e.g. `"test-project"`).
 *   - `{packageManager}` — Yarn / npm / pnpm version string
 *     (e.g. `"yarn@4.12.0"`).
 *   - `{workspaces}`     — JSON array literal of workspace globs
 *     (e.g. `["apps/*", "packages/*"]`). Interpolated as a pre-stringified
 *     JSON fragment, not a single scalar.
 */
const BUILTIN_PACKAGE_JSON_TEMPLATE = `{
  "name": "{system}",
  "private": true,
  "type": "module",
  "packageManager": "{packageManager}",
  "workspaces": {workspaces},
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "clean": "turbo clean",
    "sync": "hexagen sync",
    "sync:dry": "hexagen sync --dry-run",
    "sync:force": "hexagen sync --force",
    "lint:arch": "hexagen arch validate",
    "format": "prettier --write \\"**/*.{ts,tsx,md}\\""
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "@hexagen/sync": "^0.1.0",
    "@hexagen/arch-linter": "^0.1.0"
  }
}`;

/**
 * Built-in fallback for `tsconfig.base.json` at the monorepo root.
 *
 * No placeholders — the legacy adapter's `generateRootTsConfig()` took no
 * arguments. Retained as a string constant for uniformity with the other
 * root-file templates.
 */
const BUILTIN_TSCONFIG_BASE_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "paths": {
      "@hexagen/*": [
        "./packages/*/src/index.ts"
      ]
    }
  }
}`;

/**
 * Built-in fallback for `turbo.json` at the monorepo root.
 *
 * No placeholders — the legacy adapter's `generateRootTurboJson()` took no
 * arguments.
 */
const BUILTIN_TURBO_TEMPLATE = `{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": [
        "^build"
      ],
      "outputs": [
        "dist/**"
      ]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": [
        "^build"
      ]
    },
    "typecheck": {
      "outputs": [],
      "cache": true
    },
    "test": {
      "dependsOn": [
        "^build"
      ]
    }
  }
}`;

// -----------------------------------------------------------------------------
// Variable resolution
// -----------------------------------------------------------------------------

/**
 * Build the flat variable map consumed by the template engine.
 *
 * Manifest field mapping:
 *   - `{system}`         ← `manifest.system`
 *                          (default: `"generated-project"` if missing)
 *   - `{scope}`          ← `manifest.scope`
 *                          (default: the resolved system name)
 *   - `{packageManager}` ← `manifest.monorepo?.packageManager`
 *                          (default: `"yarn@4.12.0"` — matches legacy adapter)
 *   - `{workspaces}`     ← `manifest.monorepo?.workspaces`, pre-stringified as
 *                          a JSON array fragment with 2-space indentation
 *                          (default: `["apps/*", "packages/*"]`)
 *
 * `{workspaces}` is supplied as a pre-formatted JSON fragment rather than a
 * scalar so templates can embed it as a JSON value (e.g. `"workspaces":
 * {workspaces}`). `String()` coercion of an Array would produce a
 * comma-separated list which would not be valid JSON.
 */
function buildVars(manifest: Manifest): Record<string, string> {
  const system =
    typeof manifest.system === "string" && manifest.system.length > 0
      ? manifest.system
      : "generated-project";

  const scope =
    typeof manifest.scope === "string" && manifest.scope.length > 0
      ? manifest.scope
      : system;

  const packageManager =
    typeof manifest.monorepo?.packageManager === "string" &&
    manifest.monorepo.packageManager.length > 0
      ? manifest.monorepo.packageManager
      : "yarn@4.12.0";

  const workspacesArray =
    Array.isArray(manifest.monorepo?.workspaces) &&
    manifest.monorepo!.workspaces!.length > 0
      ? manifest.monorepo!.workspaces!
      : ["apps/*", "packages/*"];

  // Indent the inner array elements by 4 spaces (2 for the outer object,
  // 2 for the array contents) to match `JSON.stringify(obj, null, 2)`
  // output, where `obj = { workspaces: [...] }`.
  const workspaces =
    "[\n" +
    workspacesArray.map((w) => `    ${JSON.stringify(w)}`).join(",\n") +
    "\n  ]";

  return { system, scope, packageManager, workspaces };
}

// -----------------------------------------------------------------------------
// Per-file writer
// -----------------------------------------------------------------------------

/**
 * Resolve a template from the manifest; fall back to the supplied built-in
 * if the manifest doesn't declare one.
 */
function resolveTemplate(
  manifestTemplate: string | undefined,
  builtin: string,
): string {
  if (typeof manifestTemplate === "string" && manifestTemplate.length > 0) {
    return manifestTemplate;
  }
  return builtin;
}

/**
 * Interpolate a template with the given vars and log any missing-variable
 * warnings through the config logger. The warning surface intentionally goes
 * through `logger.warn` — matching the pattern used by other generators —
 * rather than being injected into the migration report.
 */
function interpolateAndWarn(
  template: string,
  vars: Record<string, string>,
  config: SyncConfig,
  fileLabel: string,
): string {
  const { output, warnings } = interpolate(template, vars);
  if (warnings.length > 0) {
    const unique = Array.from(new Set(warnings));
    config.logger.warn(
      `root-files: ${fileLabel} has unresolved template variables: ${unique
        .map((w) => `{${w}}`)
        .join(", ")}`,
    );
  }
  return output;
}

/**
 * Write a single root file via `safeWriteFileAtomic`, folding the result
 * into the running `GeneratorResult`.
 *
 * `skipGeneratedCheck: true` because the three JSON files emitted by this
 * generator cannot carry the `@generated` marker. They are still protected
 * by `isProtectedRoot` (self-regen requires `--force-root`; external mode
 * supplies `forceRoot: true` and writes freely against empty targets).
 */
async function writeRootFile(
  filePath: string,
  content: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  result: GeneratorResult,
): Promise<void> {
  const status = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report,
    true, // skipGeneratedCheck — JSON can't carry a marker
  );
  if (status === "created") result.created.push(filePath);
  if (status === "updated") result.updated.push(filePath);
  if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  if (status === "created" || status === "updated") result.totalOps += 1;
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

/**
 * Generate the three monorepo-root files:
 *   - `${workspaceRoot}/package.json`
 *   - `${workspaceRoot}/tsconfig.base.json`
 *   - `${workspaceRoot}/turbo.json`
 *
 * For each file, the generator:
 *   1. Reads the template from
 *      `config.manifest.monorepo?.rootFiles?.<key>?.template`.
 *   2. Falls back to a built-in template (matches the legacy
 *      `packages/project-generation/src/infrastructure/adapters/root-files.ts`
 *      output byte-for-byte after interpolation) when the manifest section
 *      is absent.
 *   3. Interpolates `{system}`, `{scope}`, `{packageManager}`, and
 *      `{workspaces}` (see `buildVars` for mapping).
 *   4. Writes via `safeWriteFileAtomic` with `skipGeneratedCheck=true`.
 *
 * Protection semantics (via `isProtectedRoot`):
 *   - Self-regen (no `--force-root`) → `"protected"` on existing files.
 *   - External mode (adapter sets `forceRoot: true`) → creates fresh when
 *     target is empty; overwrites when regenerating.
 *
 * I/O errors from `safeWriteFileAtomic` bubble up and are caught into the
 * `GeneratorResult` per the project's error-reporting convention.
 *
 * @param config - Sync configuration (manifest, workspaceRoot, logger, …)
 * @param report - Optional migration report recorder
 * @returns Aggregate {@link GeneratorResult} for the three files
 */
export async function generateRootFiles(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  try {
    const rootFiles = config.manifest.monorepo?.rootFiles;
    const vars = buildVars(config.manifest);

    // package.json
    const packageJsonTemplate = resolveTemplate(
      rootFiles?.packageJson?.template,
      BUILTIN_PACKAGE_JSON_TEMPLATE,
    );
    const packageJsonContent = interpolateAndWarn(
      packageJsonTemplate,
      vars,
      config,
      "package.json",
    );
    await writeRootFile(
      path.join(config.workspaceRoot, "package.json"),
      packageJsonContent,
      config,
      report,
      result,
    );

    // tsconfig.base.json
    const tsconfigTemplate = resolveTemplate(
      rootFiles?.tsConfig?.template,
      BUILTIN_TSCONFIG_BASE_TEMPLATE,
    );
    const tsconfigContent = interpolateAndWarn(
      tsconfigTemplate,
      vars,
      config,
      "tsconfig.base.json",
    );
    await writeRootFile(
      path.join(config.workspaceRoot, "tsconfig.base.json"),
      tsconfigContent,
      config,
      report,
      result,
    );

    // turbo.json
    const turboTemplate = resolveTemplate(
      rootFiles?.turbo?.template,
      BUILTIN_TURBO_TEMPLATE,
    );
    const turboContent = interpolateAndWarn(
      turboTemplate,
      vars,
      config,
      "turbo.json",
    );
    await writeRootFile(
      path.join(config.workspaceRoot, "turbo.json"),
      turboContent,
      config,
      report,
      result,
    );

    return result;
  } catch (err) {
    // Explicit error handling per AGENTS.md §9 — never silently swallow.
    const message = err instanceof Error ? err.message : String(err);
    result.error =
      err instanceof Error
        ? err
        : new Error(`root-files generation failed: ${message}`);
    result.summary = `root-files generation failed: ${message}`;
    return result;
  }
}
