import path from "node:path";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { MigrationReport } from "../migration-report.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import {
  expandDependsOn,
  type BoundedContext,
  type Manifest,
  type TsConfigTemplate,
} from "../types/manifest.js";
import type { ReportRecorder } from "../domain/types.js";

/**
 * Minimal built-in fallback template, used only when the manifest declares
 * no `workspaceDefaults.tsConfig`. Mirrors the historical hardcoded template
 * so running the generator against a malformed manifest never produces a
 * completely empty tsconfig.json.
 */
const BUILTIN_FALLBACK_TEMPLATE: TsConfigTemplate = {
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

/**
 * Resolve the workspace-level tsconfig template from the manifest.
 *
 * The manifest's canonical location for workspace defaults is
 * `monorepo.workspaceDefaults.tsConfig`, but the `Manifest` type also
 * supports a legacy root-level `workspaceDefaults.tsConfig`. We check root
 * first (so a future simplification wins cleanly) and fall back to the
 * monorepo-nested location. If neither is set, return the built-in fallback.
 */
function resolveWorkspaceTemplate(manifest: Manifest): TsConfigTemplate {
  const rootLevel = manifest.workspaceDefaults?.tsConfig;
  if (rootLevel) return rootLevel;
  const monorepoLevel = manifest.monorepo?.workspaceDefaults?.tsConfig;
  if (monorepoLevel) return monorepoLevel;
  return BUILTIN_FALLBACK_TEMPLATE;
}

/**
 * Deep-merge two `compilerOptions` objects. Override keys win; base keys
 * are preserved when not overridden. This is a one-level merge — nested
 * objects (e.g. `paths`) are replaced wholesale, matching the way
 * tsconfig.json itself treats them.
 */
function mergeCompilerOptions(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...(base ?? {}),
    ...(override ?? {}),
  };
}

/**
 * Merge two reference arrays by `path`, preserving order: entries from the
 * first argument come first, then any entries from the second argument that
 * are not already present by `path`.
 */
function mergeReferences(
  primary: Array<{ path: string }>,
  secondary: Array<{ path: string }>,
): Array<{ path: string }> {
  const seen = new Set<string>();
  const result: Array<{ path: string }> = [];
  for (const ref of primary) {
    if (!seen.has(ref.path)) {
      seen.add(ref.path);
      result.push({ path: ref.path });
    }
  }
  for (const ref of secondary) {
    if (!seen.has(ref.path)) {
      seen.add(ref.path);
      result.push({ path: ref.path });
    }
  }
  return result;
}

/**
 * Build the final tsconfig template for a given bounded context.
 *
 * Cascade (ADR-0024 §"Phase 2"):
 *   1. Start with `workspaceDefaults.tsConfig` (or built-in fallback).
 *   2. Deep-merge `bounded_contexts[name].generator.tsConfig` on top.
 *   3. Merge `depends_on`-derived references into any explicit references.
 *   4. Enforce `compilerOptions.paths = {}` unconditionally
 *      (composite-safety invariant per ADR-0001 / ADR-0004).
 */
function buildTemplate(
  base: TsConfigTemplate,
  context: BoundedContext | undefined,
): TsConfigTemplate {
  const override = context?.generator?.tsConfig;

  const compilerOptions = mergeCompilerOptions(
    base.compilerOptions,
    override?.compilerOptions,
  );

  // Composite-safety invariant (ADR-0001 §composite-safety, ADR-0004 §1).
  // Always emit paths: {} regardless of what the manifest declares, so a
  // drift in workspaceDefaults cannot break cross-package type resolution.
  compilerOptions.paths = {};

  const dependsOnRefs: Array<{ path: string }> = context
    ? Object.keys(expandDependsOn(context)).map((pkg) => ({
        path: `../${pkg.replace(/^@hexagen\//, "")}`,
      }))
    : [];

  const overrideRefs = override?.references ?? base.references ?? [];
  const references = mergeReferences(overrideRefs, dependsOnRefs);

  const template: TsConfigTemplate = {
    ...(override?.extends !== undefined
      ? { extends: override.extends }
      : base.extends !== undefined
        ? { extends: base.extends }
        : {}),
    compilerOptions,
    ...(override?.include !== undefined
      ? { include: override.include }
      : base.include !== undefined
        ? { include: base.include }
        : {}),
    ...(override?.exclude !== undefined
      ? { exclude: override.exclude }
      : base.exclude !== undefined
        ? { exclude: base.exclude }
        : {}),
    ...(references.length > 0 ? { references } : {}),
  };

  return template;
}

/**
 * Generates tsconfig.json for each module.
 *
 * As of ADR-0024 Phase 2, templates are sourced from
 * `.architecture/manifest.yaml` via `workspaceDefaults.tsConfig` and
 * per-context overrides in `bounded_contexts[].generator.tsConfig`.
 *
 * Uses safeWriteFileAtomic for dry-run safety, protection, and idempotency.
 * No @generated marker (invalid in JSON) — relies on content hash for skipping.
 */
export async function generateTsconfig(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: MigrationReport,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, "tsconfig.json");

  try {
    const base = resolveWorkspaceTemplate(config.manifest);
    const context = config.manifest.bounded_contexts?.find(
      (c) => c.name === moduleName,
    );
    const template = buildTemplate(base, context);

    const content = JSON.stringify(template, null, 2) + "\n";

    const status = await safeWriteFileAtomic(
      filePath,
      content,
      config,
      report as ReportRecorder | undefined,
    );
    if (status === "created") result.created.push(filePath);
    if (status === "updated") result.updated.push(filePath);
    if (status === "skipped" || status === "protected")
      result.skipped.push(filePath);
    result.totalOps += status === "created" || status === "updated" ? 1 : 0;

    return result;
  } catch (err) {
    // Explicit error handling per AGENTS.md §8 — never silently swallow.
    const message = err instanceof Error ? err.message : String(err);
    result.error =
      err instanceof Error
        ? err
        : new Error(`tsconfig generation failed for ${moduleName}: ${message}`);
    result.summary = `tsconfig generation failed for ${moduleName}: ${message}`;
    return result;
  }
}

export async function generateTsconfigTest(
  moduleDir: string,
  config: SyncConfig,
  report?: MigrationReport,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, "tsconfig.test.json");
  const content = `{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "noEmit": true,
      "composite": false,
      "rootDir": "..",
      "skipLibCheck": true
    },
    "include": [
      "src/**/*.ts",
      "__tests__/**/*.ts",
      "tests/**/*.ts"
    ]
  }`;
  const status = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report as ReportRecorder | undefined,
  );
  if (status === "created") result.created.push(filePath);
  if (status === "updated") result.updated.push(filePath);
  if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  result.totalOps += status === "created" || status === "updated" ? 1 : 0;
  return result;
}
