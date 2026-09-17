import path from "node:path";
import { SyncConfig } from "../config.js";
import type { LoggerPort } from "../config.js";
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

// Prettier's own defaults (also what BUILTIN_PRETTIERRC_TEMPLATE pins
// explicitly). Used ONLY as the fallback when a manifest `rootFiles.prettierrc`
// override doesn't specify a value, or its content isn't valid JSON — the
// effective values (see resolveEffectivePrettierOptions) are threaded through
// instead of these constants wherever a real override is in play.
const DEFAULT_PRETTIER_PRINT_WIDTH = 80;
const DEFAULT_PRETTIER_TAB_WIDTH = 2;

/**
 * Reads `printWidth`/`tabWidth` out of the .prettierrc.json content that is
 * ACTUALLY about to be written (built-in or manifest override alike), so the
 * generator's own array-collapsing and indentation match the config it just
 * emitted rather than a hard-coded assumption. A manifest override with a
 * different printWidth/tabWidth previously broke this silently (the emitted
 * JSON stayed collapsed/indented for the OLD defaults while the new config
 * told Prettier to expect something else) — this is the fix.
 * Falls back to Prettier's own defaults, logged at debug, if the resolved
 * content isn't valid JSON (an author-supplied override is never validated
 * here — it is still written verbatim; only OUR formatting decisions fall
 * back).
 */
function resolveEffectivePrettierOptions(
  prettierrcContent: string,
  logger: LoggerPort,
): { printWidth: number; tabWidth: number } {
  try {
    const parsed = JSON.parse(prettierrcContent) as {
      printWidth?: unknown;
      tabWidth?: unknown;
    };
    const printWidth =
      typeof parsed.printWidth === "number" && parsed.printWidth > 0
        ? parsed.printWidth
        : DEFAULT_PRETTIER_PRINT_WIDTH;
    const tabWidth =
      typeof parsed.tabWidth === "number" && parsed.tabWidth > 0
        ? parsed.tabWidth
        : DEFAULT_PRETTIER_TAB_WIDTH;
    return { printWidth, tabWidth };
  } catch {
    logger.debug(
      "root-files: .prettierrc.json content is not valid JSON — falling back " +
        "to Prettier's own defaults (printWidth 80, tabWidth 2) when deciding " +
        "the generator's own JSON array formatting",
    );
    return {
      printWidth: DEFAULT_PRETTIER_PRINT_WIDTH,
      tabWidth: DEFAULT_PRETTIER_TAB_WIDTH,
    };
  }
}

/**
 * Rescales every line's leading indentation from this file's native 2-space
 * convention to `tabWidth` spaces per level. Every hand-authored built-in
 * JSON template (and JSON.stringify's own output) indents at exactly 2
 * spaces per nesting level with no other leading whitespace use (no embedded
 * multi-line string values) — so "leading run of N*2 spaces = depth N" holds
 * for every line, and rescaling is a safe, purely mechanical text transform
 * rather than a real JSON reprint. A no-op at tabWidth 2 (the default).
 *
 * Only applied to BUILT-IN template output — an author-supplied
 * `rootFiles.*.template` is written verbatim (see generateRootFiles), same
 * as every other root file's override behavior.
 */
function reindentJson(text: string, tabWidth: number): string {
  if (tabWidth === 2) return text;
  return text.replace(/^( +)/gm, (spaces) =>
    " ".repeat(Math.round(spaces.length / 2) * tabWidth),
  );
}

/**
 * Renders a JSON array the way Prettier (default objectWrap aside — arrays
 * have no "preserve": they are always re-decided by width) would: one line
 * if `[item, item, ...]` (plus a trailing comma, when the array isn't the
 * last key in its enclosing object — Prettier counts it toward the line)
 * fits inside `printWidth` at `linePrefix`'s column, otherwise one item per
 * line, indented one `tabWidth` deeper, with the closing bracket back at
 * `indent`.
 *
 * Unlike `JSON.stringify(doc, null, N)` — which always fully expands every
 * array — this is what makes the generator's own JSON output already
 * Prettier-clean, so `yarn format` on a freshly generated project is a
 * no-op instead of reformatting every short array it touches.
 */
function formatJsonArray(
  items: readonly string[],
  indent: number,
  linePrefix: string,
  printWidth: number,
  tabWidth: number,
  hasTrailingComma: boolean,
): string {
  const rendered = items.map((item) => JSON.stringify(item));
  const inline = `[${rendered.join(", ")}]`;
  const commaWidth = hasTrailingComma ? 1 : 0;
  if (linePrefix.length + inline.length + commaWidth <= printWidth) {
    return inline;
  }
  const inner = rendered
    .map((r) => `${" ".repeat(indent + tabWidth)}${r}`)
    .join(",\n");
  return `[\n${inner}\n${" ".repeat(indent)}]`;
}

// The array-valued fields buildTurboContentFromConfig's doc can carry.
// `dependsOn`/`outputs` are declared on TurboPipeline; `globalDependencies`
// on TurboConfig — but a manifest's `turboConfig.pipeline` entries are spread
// through (`{ ...task }`, below) WITHOUT validation against that interface,
// so a manifest can legally carry any real Turbo 2 task-level array field
// here at runtime even though the TS type only names two. `inputs`, `env`,
// and `passThroughEnv` are Turbo 2's other task-level array fields (Turbo
// docs, `turbo.json` schema) — omitting them left a manifest that used one
// with an expanded, non-Prettier-clean array in the emitted turbo.json.
const TURBO_COLLAPSIBLE_ARRAY_FIELDS = [
  "dependsOn",
  "outputs",
  "inputs",
  "env",
  "passThroughEnv",
  "globalDependencies",
];

/**
 * Re-collapses the array fields `JSON.stringify(doc, null, tabWidth)` always
 * expands, so buildTurboContentFromConfig's output matches what Prettier
 * would produce from it (see {@link formatJsonArray}). `JSON.stringify` only
 * ever renders an array on one line when it is EMPTY (`"outputs": []`) —
 * every non-empty array, even a single short item, is always expanded
 * multi-line regardless of count. The regex below requires a newline right
 * after `[`, so it only ever matches what JSON.stringify expanded (1+
 * items); an empty array never matches and passes through untouched,
 * already correct as `[]`.
 */
function collapseShortJsonArrays(
  json: string,
  printWidth: number,
  tabWidth: number,
): string {
  const fieldPattern = TURBO_COLLAPSIBLE_ARRAY_FIELDS.join("|");
  // Captures an optional trailing comma (group 4) so both the width check
  // (finding #4 — Prettier counts it toward the line) and the replacement
  // (which must put it back) see it.
  const re = new RegExp(
    `^([ \\t]*)"(${fieldPattern})": \\[\\n([\\s\\S]*?)\\n\\1\\](,?)`,
    "gm",
  );
  return json.replace(
    re,
    (
      _match: string,
      indent: string,
      field: string,
      body: string,
      trailingComma: string,
    ) => {
      const items = body
        .split(",\n")
        .map((line) => JSON.parse(line.trim()) as string);
      const linePrefix = `${indent}"${field}": `;
      const hasTrailingComma = trailingComma === ",";
      return `${linePrefix}${formatJsonArray(items, indent.length, linePrefix, printWidth, tabWidth, hasTrailingComma)}${trailingComma}`;
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

  // NOT formatJsonArray: Prettier infers the special `json-stringify` parser
  // for a file literally named `package.json` (also package-lock.json,
  // composer.json) — verified via `prettier.getFileInfo("package.json")`.
  // That parser ignores printWidth entirely and always renders exactly like
  // `JSON.stringify(value, null, 2)`: every array fully expanded, regardless
  // of how short it is. `formatJsonArray`'s width-based collapsing is correct
  // for turbo.json/tsconfig.base.json (plain `json` parser, confirmed via the
  // same probe) but would make package.json NOT Prettier-clean — this is the
  // one array field the emitted JSON always fully expands.
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
function buildTurboContentFromConfig(
  manifest: Manifest,
  prettierOptions: { printWidth: number; tabWidth: number },
): string {
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
  // `prettierOptions.tabWidth` (NOT a hard-coded 2): JSON.stringify's own
  // indent unit becomes the real final indent, so collapseShortJsonArrays'
  // width check (which reads that indent back via regex) needs no separate
  // rescale — see reindentJson's doc comment for why the two static-template
  // JSON files (package.json, tsconfig.base.json) need a rescale pass instead.
  return (
    collapseShortJsonArrays(
      JSON.stringify(doc, null, prettierOptions.tabWidth),
      prettierOptions.printWidth,
      prettierOptions.tabWidth,
    ) + "\n"
  );
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

    // Resolved FIRST, and not yet written: every other JSON root file below
    // must match what THIS exact content would tell Prettier to do — a
    // manifest override (`rootFiles.prettierrc.template`) changing
    // printWidth/tabWidth previously left the generator silently formatting
    // against the OLD defaults. See resolveEffectivePrettierOptions.
    const prettierrcTemplate = resolveTemplate(
      rootFiles?.prettierrc?.template,
      BUILTIN_PRETTIERRC_TEMPLATE,
    );
    const prettierrcContent = interpolateAndWarn(
      prettierrcTemplate,
      vars,
      config,
      ".prettierrc.json",
    );
    const prettierOptions = resolveEffectivePrettierOptions(
      prettierrcContent,
      config.logger,
    );

    const usingBuiltinPackageJson = !rootFiles?.packageJson?.template;
    const packageJsonTemplate = resolveTemplate(
      rootFiles?.packageJson?.template,
      BUILTIN_PACKAGE_JSON_TEMPLATE,
    );
    let packageJsonContent = interpolateAndWarn(
      packageJsonTemplate,
      vars,
      config,
      "package.json",
    );
    // Reindent only the BUILT-IN template's output — an author-supplied
    // template is written verbatim, same as every other root file override.
    if (usingBuiltinPackageJson) {
      packageJsonContent = reindentJson(
        packageJsonContent,
        prettierOptions.tabWidth,
      );
    }
    await writeRootFile(
      path.join(config.workspaceRoot, "package.json"),
      packageJsonContent,
      config,
      report,
      result,
    );

    const usingBuiltinTsconfig = !rootFiles?.tsConfig?.template;
    const tsconfigTemplate = resolveTemplate(
      rootFiles?.tsConfig?.template,
      BUILTIN_TSCONFIG_BASE_TEMPLATE,
    );
    let tsconfigContent = interpolateAndWarn(
      tsconfigTemplate,
      vars,
      config,
      "tsconfig.base.json",
    );
    if (usingBuiltinTsconfig) {
      tsconfigContent = reindentJson(tsconfigContent, prettierOptions.tabWidth);
    }
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
    let turboContent: string;
    if (!hasExplicitTurboTemplate && config.manifest.monorepo?.turboConfig) {
      turboContent = buildTurboContentFromConfig(
        config.manifest,
        prettierOptions,
      );
    } else if (!hasExplicitTurboTemplate) {
      turboContent = reindentJson(
        interpolateAndWarn(BUILTIN_TURBO_TEMPLATE, vars, config, "turbo.json"),
        prettierOptions.tabWidth,
      );
    } else {
      // Author-supplied full file — most-specific override, written verbatim.
      turboContent = interpolateAndWarn(
        explicitTurboTemplate,
        vars,
        config,
        "turbo.json",
      );
    }
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
    // Content was already resolved above (before package.json/tsconfig/turbo)
    // so their formatting could match it — written here, last, purely for
    // read order (the six pre-existing root files first, this one after).
    //
    // Two decisions recorded deliberately, not artefacts of this ordering:
    //
    // - EXISTING projects (generated before this file existed) do not
    //   receive .prettierrc.json on their next `sync` unless it runs with
    //   --force-root: like every other protected root file (isProtectedRoot
    //   in fs-utils.ts checks protection before existence, uniformly, for
    //   all seven), a NEW protected file is skipped exactly like an existing
    //   one would be — `sync --check` reports zero pending ops, same as the
    //   SETUP.md precedent (see "does NOT recreate a deleted SETUP.md on a
    //   normal re-sync" above). Silent non-adoption on pre-existing projects
    //   is the accepted, established tradeoff for every protected root file,
    //   not a gap introduced by adding a seventh one.
    // - A manifest override containing a literal `}}` (e.g. a compact-JSON
    //   `overrides` block, the shape this file's own comment above invites
    //   for opting prose formatting back in) is silently mangled: `}}` → `}`
    //   is `interpolate()`'s (packages/shared/src/types/interpolate.ts)
    //   escape rule for EVERY root file's template, not something specific
    //   to prettierrc, and rewriting that shared escaping rule is out of
    //   this lane's scope — a manifest author using pretty-printed JSON
    //   (the existing test/example style throughout this repo) never hits
    //   it; only a hand-compacted override with adjacent closing braces
    //   would. Documented here rather than fixed.
    await writeRootFile(
      path.join(config.workspaceRoot, ".prettierrc.json"),
      prettierrcContent,
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
