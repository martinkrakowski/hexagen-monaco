import path from "node:path";
import { SyncConfig } from "../config.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { interpolate } from "../template-engine.js";
import { resolveScope, type Manifest } from "../types/manifest.js";
import {
  BUILTIN_PACKAGE_JSON_TEMPLATE,
  BUILTIN_TSCONFIG_BASE_TEMPLATE,
  BUILTIN_TURBO_TEMPLATE,
  BUILTIN_GITIGNORE_TEMPLATE,
  BUILTIN_YARNRC_TEMPLATE,
  BUILTIN_SETUP_MD_TEMPLATE,
} from "./root-file-templates.js";
import type { ReportRecorder } from "../domain/types.js";
import { resolveToolchainVersion } from "../toolchain-version.js";

function buildVars(
  manifest: Manifest,
  toolchainVersion: string,
): Record<string, string> {
  const system =
    typeof manifest.system === "string" && manifest.system.length > 0
      ? manifest.system
      : "generated-project";

  // Single source of truth for the project's npm scope (sanitized).
  const scope = resolveScope(manifest);

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

  const workspaces =
    "[\n" +
    workspacesArray.map((w) => `    ${JSON.stringify(w)}`).join(",\n") +
    "\n  ]";

  // toolchainVersion: the workspace package is `@hexagen/sync` but the pins
  // are emitted under the public `@hexagen-monaco/*` scope — same version
  // number by the co-release invariant (publish staging rewrites only the
  // scope; publish.yml releases both packages at this version together).
  return { system, scope, packageManager, workspaces, toolchainVersion };
}

function resolveTemplate(
  manifestTemplate: string | undefined,
  builtin: string,
): string {
  if (typeof manifestTemplate === "string" && manifestTemplate.length > 0) {
    return manifestTemplate;
  }
  return builtin;
}

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
    true,
  );
  recordWriteStatus(result, filePath, status);
}

export async function generateRootFiles(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  // PR-A3 (RCA #1): resolved OUTSIDE the try below on purpose. The engine
  // treats `result.error` as a summary statistic, not a run failure — caught
  // here, a degenerate version would be swallowed into a green exit. Thrown
  // here, it propagates to the engine's catch, which always rethrows (PR-A1
  // honest exits): a scaffold that cannot know its own version must abort,
  // never emit `"^0.0.0"` pins.
  const toolchainVersion = resolveToolchainVersion();

  try {
    const rootFiles = config.manifest.monorepo?.rootFiles;
    const vars = buildVars(config.manifest, toolchainVersion);

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

    // First-run install scaffolding (Item 2 — CI hardening). Threaded through
    // resolveTemplate like the files above so a manifest can override them, and
    // through interpolateAndWarn so {scope}/{packageManager} resolve.
    const gitignoreTemplate = resolveTemplate(
      rootFiles?.gitignore?.template,
      BUILTIN_GITIGNORE_TEMPLATE,
    );
    await writeRootFile(
      path.join(config.workspaceRoot, ".gitignore"),
      interpolateAndWarn(gitignoreTemplate, vars, config, ".gitignore"),
      config,
      report,
      result,
    );

    const yarnrcTemplate = resolveTemplate(
      rootFiles?.yarnrc?.template,
      BUILTIN_YARNRC_TEMPLATE,
    );
    await writeRootFile(
      path.join(config.workspaceRoot, ".yarnrc.yml"),
      interpolateAndWarn(yarnrcTemplate, vars, config, ".yarnrc.yml"),
      config,
      report,
      result,
    );

    const setupTemplate = resolveTemplate(
      rootFiles?.setup?.template,
      BUILTIN_SETUP_MD_TEMPLATE,
    );
    await writeRootFile(
      path.join(config.workspaceRoot, "SETUP.md"),
      interpolateAndWarn(setupTemplate, vars, config, "SETUP.md"),
      config,
      report,
      result,
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error =
      err instanceof Error
        ? err
        : new Error(`root-files generation failed: ${message}`);
    result.summary = `root-files generation failed: ${message}`;
    return result;
  }
}
