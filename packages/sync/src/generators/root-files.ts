import path from "node:path";
import { SyncConfig } from "../config.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { interpolate } from "../template-engine.js";
import {
  resolveScope,
  type Manifest,
  type TurboPipeline,
} from "../types/manifest.js";
import {
  BUILTIN_PACKAGE_JSON_TEMPLATE,
  BUILTIN_TSCONFIG_BASE_TEMPLATE,
  BUILTIN_TURBO_TEMPLATE,
  BUILTIN_GITIGNORE_TEMPLATE,
  BUILTIN_YARNRC_TEMPLATE,
  BUILTIN_SETUP_MD_TEMPLATE,
  BUILTIN_PRETTIERRC_TEMPLATE,
} from "./root-file-templates.js";
import type { ReportRecorder } from "../domain/types.js";
import { resolveToolchainVersion } from "../toolchain-version.js";

// Prettier's default printWidth. Kept in lockstep with BUILTIN_PRETTIERRC_TEMPLATE
// (root-file-templates.ts) by the no-diff generator test — that test is the
// thing that would go red if the two drifted apart.
const PRETTIER_PRINT_WIDTH = 80;

/**
 * Renders a JSON array the way Prettier (default objectWrap aside — arrays
 * have no "preserve": they are always re-decided by width) would: one line
 * if `[item, item, ...]` fits inside printWidth at `linePrefix`'s column,
 * otherwise one item per line with the closing bracket back at `indent`.
 *
 * Unlike `JSON.stringify(doc, null, 2)` — which always fully expands every
 * array — this is what makes the generator's own JSON output already
 * Prettier-clean, so `yarn format` on a freshly generated project is a
 * no-op instead of reformatting every short array it touches.
 */
function formatJsonArray(
  items: readonly string[],
  indent: number,
  linePrefix: string,
): string {
  const rendered = items.map((item) => JSON.stringify(item));
  const inline = `[${rendered.join(", ")}]`;
  if (linePrefix.length + inline.length <= PRETTIER_PRINT_WIDTH) {
    return inline;
  }
  const inner = rendered
    .map((r) => `${" ".repeat(indent + 2)}${r}`)
    .join(",\n");
  return `[\n${inner}\n${" ".repeat(indent)}]`;
}

// The only array-valued fields buildTurboContentFromConfig's doc can ever
// contain (TurboPipeline.dependsOn/outputs, TurboConfig.globalDependencies —
// see ../types/manifest/monorepo.ts). Bounded and known, so a targeted
// post-process on JSON.stringify's output is safe: no free-form JSON is
// ever routed through this, only turbo.json's own fixed shape.
const TURBO_COLLAPSIBLE_ARRAY_FIELDS = [
  "dependsOn",
  "outputs",
  "globalDependencies",
];

/**
 * Re-collapses the array fields `JSON.stringify(doc, null, 2)` always
 * expands, so buildTurboContentFromConfig's output matches what Prettier
 * would produce from it (see {@link formatJsonArray}). Only touches arrays
 * JSON.stringify rendered multi-line with 2+ items; an empty/one-shot array
 * JSON.stringify already inlines (`"outputs": []`) passes through untouched.
 */
function collapseShortJsonArrays(json: string): string {
  const fieldPattern = TURBO_COLLAPSIBLE_ARRAY_FIELDS.join("|");
  const re = new RegExp(
    `^([ \\t]*)"(${fieldPattern})": \\[\\n([\\s\\S]*?)\\n\\1\\]`,
    "gm",
  );
  return json.replace(
    re,
    (_match: string, indent: string, field: string, body: string) => {
      const items = body
        .split(",\n")
        .map((line) => JSON.parse(line.trim()) as string);
      const linePrefix = `${indent}"${field}": `;
      return `${linePrefix}${formatJsonArray(items, indent.length, linePrefix)}`;
    },
  );
}

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

  const workspaces = formatJsonArray(workspacesArray, 2, '  "workspaces": ');

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

/**
 * Framework-specific `build` outputs (F15): Next.js and Nitro apps do not
 * build into `dist/**`, so without these globs turbo warns "no output files
 * found" and their builds are uncacheable. `!.next/cache/**` follows Turbo's
 * own Next.js guidance (the cache dir is machine-local state, not an output).
 */
function frameworkBuildOutputs(manifest: Manifest): string[] {
  const frameworks = new Set((manifest.apps ?? []).map((app) => app.framework));
  const extras: string[] = [];
  if (frameworks.has("next.js")) {
    extras.push(".next/**", "!.next/cache/**");
  }
  if (frameworks.has("nitro")) {
    extras.push(".output/**", ".nitro/**");
  }
  return extras;
}

/**
 * Build turbo.json from the manifest's `monorepo.turboConfig` (F15 — the
 * manifest declared `globalDependencies` and a `pipeline` that emission
 * silently dropped, so env changes never invalidated the cache).
 *
 *   - `pipeline` (the manifest key) is emitted as Turbo 2's `tasks`.
 *   - Manifest tasks REPLACE the same-named built-in task; built-in tasks the
 *     manifest doesn't mention (e.g. `dev`) are kept so root scripts like
 *     `turbo dev` still resolve.
 *   - `globalDependencies` is emitted verbatim when non-empty.
 *   - Next/Nitro build outputs are appended to the `build` task (see
 *     {@link frameworkBuildOutputs}).
 *
 * An explicit `rootFiles.turbo.template` still wins over this (most-specific
 * author override), and a manifest with NO `turboConfig` falls back to the
 * built-in template byte-for-byte — existing projects only see a different
 * turbo.json once they sync with `--force-root` (turbo.json is protected;
 * `sync --check` counts protected files as zero ops, so converged trees stay
 * green).
 */
function buildTurboContentFromConfig(manifest: Manifest): string {
  const turboConfig = manifest.monorepo?.turboConfig ?? {};
  const builtin = JSON.parse(BUILTIN_TURBO_TEMPLATE) as {
    $schema: string;
    tasks: Record<string, TurboPipeline>;
  };

  const tasks: Record<string, TurboPipeline> = { ...builtin.tasks };
  for (const [name, task] of Object.entries(turboConfig.pipeline ?? {})) {
    tasks[name] = { ...task };
  }

  const extras = frameworkBuildOutputs(manifest);
  if (extras.length > 0) {
    const build: TurboPipeline = { ...(tasks["build"] ?? {}) };
    const outputs = [...(build.outputs ?? [])];
    for (const glob of extras) {
      if (!outputs.includes(glob)) outputs.push(glob);
    }
    build.outputs = outputs;
    tasks["build"] = build;
  }

  const globalDependencies = turboConfig.globalDependencies ?? [];
  const doc: Record<string, unknown> = {
    $schema: builtin.$schema,
    ...(globalDependencies.length > 0 ? { globalDependencies } : {}),
    tasks,
  };
  return collapseShortJsonArrays(JSON.stringify(doc, null, 2)) + "\n";
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

    // turbo.json precedence (F15): explicit `rootFiles.turbo.template`
    // (author-supplied full file) > manifest `monorepo.turboConfig`
    // (structured, built via buildTurboContentFromConfig) > built-in template.
    const explicitTurboTemplate = rootFiles?.turbo?.template;
    const hasExplicitTurboTemplate =
      typeof explicitTurboTemplate === "string" &&
      explicitTurboTemplate.length > 0;
    const turboContent =
      !hasExplicitTurboTemplate && config.manifest.monorepo?.turboConfig
        ? buildTurboContentFromConfig(config.manifest)
        : interpolateAndWarn(
            resolveTemplate(explicitTurboTemplate, BUILTIN_TURBO_TEMPLATE),
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

    // L3 (gates-for-generated-projects): the emitted `format` script
    // (package.json, above) needs a config or it reformats to Prettier's
    // defaults on first run, burying real changes under whole-file churn.
    const prettierrcTemplate = resolveTemplate(
      rootFiles?.prettierrc?.template,
      BUILTIN_PRETTIERRC_TEMPLATE,
    );
    await writeRootFile(
      path.join(config.workspaceRoot, ".prettierrc.json"),
      interpolateAndWarn(prettierrcTemplate, vars, config, ".prettierrc.json"),
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
    // B-1 (PR-B2 review): same as the tsconfig/eslint catches — a silent
    // swallow here left the run looking converged (exit 0, zero ops).
    config.logger.error(result.summary);
    if (report) report.record("error", "root-files", result.summary);
    return result;
  }
}
