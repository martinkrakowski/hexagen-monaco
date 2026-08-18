#!/usr/bin/env node
/// <reference types='node' />
import * as fsPromises from "fs/promises";
import * as fs from "fs";
import { Project } from "ts-morph";
import path from "node:path";
import { createConsoleLogger } from "./logger.js";
// Manifest validation uses the schema from @hexagen/project-configuration
// (packages/project-configuration/src/domain/model/manifest-schema/manifest-schema.ts)
// via mergeSplitManifest(). Do not add a local schema to this package —
// the authoritative schema lives with the domain that owns the manifest.
import { mergeSplitManifest } from "@hexagen/project-configuration/server";
import type { Manifest } from "@hexagen/sync";
import type { LinterConfig } from "./subpath-violation.js";
import { isSubpathViolation } from "./subpath-violation.js";
import {
  buildManifestImportGrants,
  isCrossPackageViolation,
} from "./cross-package-violation.js";
import {
  matchingImportScope,
  resolveLintScope,
  resolvedPathIsWorkspaceImport,
  scopesToTry,
  unscopedContextImport,
} from "./resolve-scope.js";
import {
  isEmptyLayout,
  loadLayoutConfig,
  matchesIgnorePattern,
  type LayoutConfig,
} from "./layout-config.js";
import {
  checkUnexpectedMarker,
  checkMissingMarker,
} from "./server-marker-violation.js";
import {
  checkRequiredCommunication,
  type CrossContextEdgeInput,
} from "./required-communication-violation.js";
import type { LayerRules } from "./layer-import-violation.js";
import {
  getLayerAllowedImports,
  importPathSatisfiesLayers,
  isSharedKernelAllowed,
} from "./layer-import-violation.js";
import type { OptionalYamlConfig } from "./optional-yaml-config.js";
import { loadOptionalYamlConfig } from "./optional-yaml-config.js";
import {
  checkCrossLayerRelativeImport,
  checkNodeBuiltinInLayer,
  checkNpmPackageInDomain,
  DEFAULT_LAYER_NAMES,
  resolveFileHexagonalLayer,
} from "./layer-purity-violation.js";
import type { BaselineEntry, ViolationRecord } from "./ratchet-baseline.js";
import {
  DEFAULT_BASELINE_RELATIVE_PATH,
  mergeSuppressionMetadata,
  parseBaseline,
  partitionAgainstBaseline,
  serializeBaseline,
} from "./ratchet-baseline.js";
import {
  computePrDiff,
  formatPrComment,
  parseBaseBaselineText,
  parseRenameNameStatus,
} from "./pr-diff.js";
import {
  renameNameStatus,
  resolveBaseRef,
  showFileAtRef,
  stagedFiles,
} from "./git-ops.js";

const logger = createConsoleLogger(process.argv.includes("--json"));

// ─── Exit-code vocabulary ───────────────────────────────────────────────────
//
//   0  ran to completion, tree is compliant
//   1  ran to completion, found violations NOT in the baseline
//   2  COULD NOT RUN — nothing was checked, so trust nothing
//
// 2 exists because 1 used to mean both "found violations" and every fail-closed
// abort in this file (no project root, missing/unloadable manifest, a config or
// baseline that exists but will not parse). A caller that cannot tell those
// apart cannot tell "the gate found problems" from "the gate never ran", which
// is the same class of defect as reporting a pass you never verified. The
// launcher at `bin/lint-arch.mjs` uses 2 for the same meaning when this file's
// build output is missing entirely.
//
// The aborts themselves are unchanged and still non-zero, so anything that only
// asks "did this succeed?" behaves exactly as before.
const EXIT_COULD_NOT_RUN = 2;

// ─── Dynamic Project Root Discovery ─────────────────────────────────────────

function findProjectRoot(): string {
  // A. CLI argument override (--root <path>)
  const rootArgIndex = process.argv.indexOf("--root");
  if (rootArgIndex !== -1 && process.argv[rootArgIndex + 1]) {
    return path.resolve(process.argv[rootArgIndex + 1]);
  }

  // B. Environment variable override
  if (process.env.HEXAGEN_ROOT) {
    return path.resolve(process.env.HEXAGEN_ROOT);
  }

  // C. Walk up from cwd() to find .architecture/manifest.yaml or layout.yaml
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const archDir = path.join(dir, ".architecture");
    if (
      fs.existsSync(path.join(archDir, "manifest.yaml")) ||
      fs.existsSync(path.join(archDir, "layout.yaml"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  // D. Walk up to find monorepo root (package.json with workspaces)
  dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.workspaces) return dir;
      } catch {
        // Ignore parse errors and continue upward
      }
    }
    dir = path.dirname(dir);
  }

  // E. Fatal Error (Strict Mode)
  logger.error(
    "FATAL ERROR: Could not find project root. No .architecture/manifest.yaml found.",
  );
  logger.error(
    "Please run this command from within a HexaGen project, or specify the root using --root <path> or the HEXAGEN_ROOT environment variable.",
  );
  process.exit(EXIT_COULD_NOT_RUN);
}

const ROOT_DIR = findProjectRoot();

// ─── Configuration Paths ────────────────────────────────────────────────────

// --manifest <path> overrides the default manifest location.
// When provided, the linter reads this file instead of .architecture/manifest.yaml.
// All other config paths (layer-rules, linter-config, tsconfig) still resolve
// from ROOT_DIR so that the linter can still find the project's invariants.
const manifestArgIndex = process.argv.indexOf("--manifest");
const MANIFEST_PATH =
  manifestArgIndex !== -1 && process.argv[manifestArgIndex + 1]
    ? path.resolve(process.argv[manifestArgIndex + 1])
    : path.join(ROOT_DIR, ".architecture", "manifest.yaml");
const LAYER_RULES_PATH = path.join(
  ROOT_DIR,
  ".architecture",
  "invariants",
  "layer-rules.yaml",
);
const LINTER_CONFIG_PATH = path.join(
  ROOT_DIR,
  ".architecture",
  "invariants",
  "linter-config.yaml",
);
const LAYOUT_PATH = path.join(ROOT_DIR, ".architecture", "layout.yaml");
const tsconfigArgIndex = process.argv.indexOf("--tsconfig");
const tsconfigArg =
  tsconfigArgIndex !== -1 ? process.argv[tsconfigArgIndex + 1] : undefined;
if (tsconfigArgIndex !== -1 && (!tsconfigArg || tsconfigArg.startsWith("-"))) {
  logger.error("FATAL ERROR: --tsconfig requires a path argument.");
  process.exit(EXIT_COULD_NOT_RUN);
}

// ─── Ratchet baseline (ADR-0054 §1) ─────────────────────────────────────────
//
// `--baseline <path>` overrides the location; `--update-baseline` rewrites the
// file from the current run instead of enforcing against it (seeding, and
// deliberate regeneration). The baseline is resolved from ROOT_DIR so a
// generated project inherits the same convention with zero configuration, and
// so `--root <elsewhere> --baseline ci/base.json` names a file inside the
// project being linted rather than one beside whatever cwd the run started in.
// An absolute `--baseline` is honoured as given (path.resolve keeps it).
//
// A `--baseline` with no value is FATAL rather than a silent fall back to the
// default path: enforcing against a different file than the one the caller
// named is exactly the "reported a pass it never verified" failure the
// fail-closed contract below exists to prevent.
const baselineArgIndex = process.argv.indexOf("--baseline");
const baselineArg =
  baselineArgIndex !== -1 ? process.argv[baselineArgIndex + 1] : undefined;
if (baselineArgIndex !== -1 && (!baselineArg || baselineArg.startsWith("-"))) {
  logger.error("FATAL ERROR: --baseline requires a path argument.");
  logger.error(
    "  Refusing to fall back to the default baseline: that would enforce against a different file than the one requested.",
  );
  process.exit(EXIT_COULD_NOT_RUN);
}
const BASELINE_PATH = baselineArg
  ? path.resolve(ROOT_DIR, baselineArg)
  : path.join(ROOT_DIR, ...DEFAULT_BASELINE_RELATIVE_PATH.split("/"));
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
// `--ratchet` is the documented public name for the default baseline mode.
// It is accepted so CI / the composite action can name the contract; the
// linter already ratchets whenever a baseline file is present.
const RATCHET = process.argv.includes("--ratchet");
void RATCHET;
const STAGED = process.argv.includes("--staged");
const PR_DIFF = process.argv.includes("--pr-diff");
const JSON_MODE = process.argv.includes("--json");
const baseRefArgIndex = process.argv.indexOf("--base-ref");
const baseRefArg =
  baseRefArgIndex !== -1 ? process.argv[baseRefArgIndex + 1] : undefined;
if (baseRefArgIndex !== -1 && (!baseRefArg || baseRefArg.startsWith("-"))) {
  logger.error("FATAL ERROR: --base-ref requires a git ref argument.");
  process.exit(EXIT_COULD_NOT_RUN);
}
const commentFileArgIndex = process.argv.indexOf("--comment-file");
const commentFileArg =
  commentFileArgIndex !== -1
    ? process.argv[commentFileArgIndex + 1]
    : undefined;
if (
  commentFileArgIndex !== -1 &&
  (!commentFileArg || commentFileArg.startsWith("-"))
) {
  logger.error("FATAL ERROR: --comment-file requires a path argument.");
  process.exit(EXIT_COULD_NOT_RUN);
}

// ─── Load Manifest (Strict Mode) ────────────────────────────────────────────

if (!fs.existsSync(MANIFEST_PATH)) {
  logger.error(
    `FATAL ERROR: Architecture manifest not found at ${MANIFEST_PATH}`,
  );
  logger.error("The linter requires a manifest to validate against. Aborting.");
  process.exit(EXIT_COULD_NOT_RUN);
}

let manifest: Manifest;
try {
  manifest = (await mergeSplitManifest(ROOT_DIR, MANIFEST_PATH)) as Manifest;
} catch (e) {
  const error = e as Error;
  logger.error(
    `FATAL ERROR: Could not load architecture manifest from ${MANIFEST_PATH}`,
  );
  if (error.message) {
    logger.error(`  ${error.message}`);
  }
  process.exit(EXIT_COULD_NOT_RUN);
}

// ─── Dynamic Scope and Workspace Path ───────────────────────────────────────

// SCOPE must match what the generator emits — see resolveLintScope (a
// dependency-free mirror of @hexagen/sync's resolveScope).
const SCOPE = `@${resolveLintScope(manifest)}`;

let workspacesDir = "packages";
if (
  manifest.monorepo?.workspaces &&
  Array.isArray(manifest.monorepo.workspaces)
) {
  const pkgWorkspace = manifest.monorepo.workspaces.find(
    (w: string) => w.includes("/*") && !w.includes("apps/"),
  );
  if (pkgWorkspace) {
    workspacesDir = pkgWorkspace.split("/")[0];
  }
}
const PKG_ROOT_PATH = path.join(ROOT_DIR, workspacesDir);

// ─── Load Optional Configs ──────────────────────────────────────────────────

const readUtf8 = (p: string) => fsPromises.readFile(p, "utf8");

/**
 * Apply an optional-config load, holding the linter's fail-closed contract.
 *
 * A MISSING file legitimately falls back to defaults — that is the documented
 * behavior for a project that declares no invariants. A file that EXISTS and
 * cannot be read or parsed is fatal instead: defaulting there would disable
 * every rule the file declares and the run would still print "Architecture is
 * compliant", reporting a pass it never verified.
 */
function useOptionalConfig<T>(
  load: OptionalYamlConfig<T>,
  filePath: string,
  fileName: string,
): T {
  switch (load.kind) {
    case "loaded":
      return load.value;
    case "missing":
      logger.warn(
        `Could not load ${fileName} from ${filePath}, using defaults`,
      );
      return {} as T;
    case "invalid":
      logger.error(
        `FATAL ERROR: ${fileName} exists but could not be loaded from ${filePath}`,
      );
      logger.error(`  ${load.reason}`);
      logger.error(
        "  Refusing to fall back to defaults: that would silently disable the rules this file declares and still report compliance.",
      );
      process.exit(EXIT_COULD_NOT_RUN);
  }
}

const layerRules = useOptionalConfig(
  await loadOptionalYamlConfig<LayerRules>(LAYER_RULES_PATH, readUtf8),
  LAYER_RULES_PATH,
  "layer-rules.yaml",
);

const linterConfig = useOptionalConfig(
  await loadOptionalYamlConfig<LinterConfig>(LINTER_CONFIG_PATH, readUtf8),
  LINTER_CONFIG_PATH,
  "linter-config.yaml",
);

const layoutLoad = await loadLayoutConfig(LAYOUT_PATH, readUtf8);
let layout: LayoutConfig | undefined;
switch (layoutLoad.kind) {
  case "missing":
    layout = undefined;
    break;
  case "invalid":
    logger.error(
      `FATAL ERROR: layout.yaml exists but could not be loaded from ${LAYOUT_PATH}`,
    );
    logger.error(`  ${layoutLoad.reason}`);
    logger.error(
      "  Refusing to continue: a misspelled mapping would silently produce a partial report.",
    );
    process.exit(EXIT_COULD_NOT_RUN);
    break;
  case "loaded":
    layout = isEmptyLayout(layoutLoad.value) ? undefined : layoutLoad.value;
    break;
}

/**
 * Load the committed baseline.
 *
 * MISSING is legitimate — a project with no accepted debt (or one that has burnt
 * its baseline to zero and deleted the file) simply enforces everything. A file
 * that EXISTS but cannot be parsed is fatal, for the same reason a malformed
 * config is: silently treating it as empty would turn every baselined violation
 * into a failure, and silently treating it as absent would do the same — either
 * way the run would be reporting something it never verified.
 */
function loadBaseline(filePath: string): BaselineEntry[] {
  if (!fs.existsSync(filePath)) {
    logger.info(
      `No arch-lint baseline at ${path.relative(ROOT_DIR, filePath)} — every violation is enforced.`,
    );
    return [];
  }
  try {
    return parseBaseline(fs.readFileSync(filePath, "utf8")).entries;
  } catch (e) {
    logger.error(
      `FATAL ERROR: arch-lint baseline exists but could not be loaded from ${filePath}`,
    );
    logger.error(`  ${(e as Error).message}`);
    logger.error(
      "  Refusing to fall back: an unreadable baseline would silently change what the ratchet enforces.",
    );
    process.exit(EXIT_COULD_NOT_RUN);
  }
}

const baselineEntries = UPDATE_BASELINE ? [] : loadBaseline(BASELINE_PATH);

// ─── TypeScript Project ─────────────────────────────────────────────────────

function resolveTsconfigPath(): string {
  if (tsconfigArg) return path.resolve(ROOT_DIR, tsconfigArg);
  if (layout?.tsconfig) return path.resolve(ROOT_DIR, layout.tsconfig);
  const base = path.join(ROOT_DIR, "tsconfig.base.json");
  if (fs.existsSync(base)) return base;
  return path.join(ROOT_DIR, "tsconfig.json");
}

const TSCONFIG_PATH = resolveTsconfigPath();

let project: Project;
try {
  if (!fs.existsSync(TSCONFIG_PATH)) {
    throw new Error(`tsconfig not found at ${TSCONFIG_PATH}`);
  }
  project = new Project({
    tsConfigFilePath: TSCONFIG_PATH,
  });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  logger.error(
    `FATAL ERROR: Could not load TypeScript project from ${TSCONFIG_PATH}`,
  );
  logger.error(`  ${message}`);
  logger.error(
    "  Pass --tsconfig <path>, set layout.yaml `tsconfig:`, or add a tsconfig.json at the project root.",
  );
  process.exit(EXIT_COULD_NOT_RUN);
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function isTestDoubleOrTest(filePath: string): boolean {
  const testDoubleRules = linterConfig.test_double_rules;
  if (!testDoubleRules?.allowed_cross_package_imports) return false;
  return filePath.includes("__tests__/") || filePath.includes("__tests__\\");
}

// ─── Main Lint Check ────────────────────────────────────────────────────────

/** Repo-relative, posix-separated — the identity half of a baseline key. */
function toRelativePosix(filePath: string): string {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join("/");
}

/**
 * Every layer name the linter may see in a path: the hexagonal defaults plus any
 * bare layer declared in `layer-rules.yaml`, so a project that invents a layer
 * gets its relative imports classified too.
 */
const LAYER_NAMES: readonly string[] = [
  ...new Set([
    ...DEFAULT_LAYER_NAMES,
    ...Object.keys(layerRules.layers ?? {})
      .filter((name) => !name.includes("/"))
      .map((name) => name),
  ]),
];

function contextRootAbs(moduleName: string): string {
  const mapped = layout?.contexts?.[moduleName]?.root;
  if (mapped) return path.resolve(ROOT_DIR, mapped);
  return path.join(PKG_ROOT_PATH, moduleName);
}

function isIgnoredFile(filePath: string): boolean {
  if (!layout?.ignore || layout.ignore.length === 0) return false;
  return matchesIgnorePattern(toRelativePosix(filePath), layout.ignore);
}

function layoutTargetLayerAllowed(
  importPath: string,
  allowed: string[],
): boolean {
  if (!layout?.contexts) return false;
  for (const [name, ctx] of Object.entries(layout.contexts)) {
    const layer = resolveFileHexagonalLayer(importPath, {
      contextRootAbs: contextRootAbs(name),
      layerDirs: ctx.layers,
      layerNames: LAYER_NAMES,
    });
    if (layer && allowed.includes(layer)) return true;
  }
  return false;
}

function checkArchitecturalIntegrity(): {
  errors: ViolationRecord[];
  filesScanned: number;
} {
  const errors: ViolationRecord[] = [];
  const warnings: string[] = [];
  const modules: readonly {
    name: string;
    type?: string;
    depends_on?: string[];
  }[] = manifest.bounded_contexts ?? [];
  const contextNames = new Set<string>(modules.map((m) => m.name));
  const extraScopes = [
    ...(layout?.scopes ?? []),
    ...Object.values(layout?.contexts ?? {}).flatMap((ctx) => {
      const pkgJson = path.join(
        path.resolve(ROOT_DIR, ctx.root),
        "package.json",
      );
      if (!fs.existsSync(pkgJson)) return [];
      try {
        const name = (
          JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { name?: string }
        ).name;
        if (typeof name === "string" && name.startsWith("@")) {
          return [name.slice(1).split("/")[0]];
        }
      } catch {
        return [];
      }
      return [];
    }),
  ];
  const importScopes = scopesToTry(resolveLintScope(manifest), extraScopes);
  const contextRoots = modules.map((m) => contextRootAbs(m.name));
  let filesScanned = 0;

  /** Record a violation. `specifier` is "" for findings with no import. */
  const record = (
    rule: string,
    filePath: string,
    specifier: string,
    message: string,
  ): ViolationRecord => ({
    rule,
    file: toRelativePosix(filePath),
    specifier,
    message,
  });

  // Manifest-derived import grants (ADR-0043): each context's `depends_on`
  // plus every `type: shared-kernel` context. Built once per run; the
  // invariants config remains operative as additional constraints inside
  // isCrossPackageViolation.
  const manifestGrants = buildManifestImportGrants(modules);

  modules.forEach((moduleInfo) => {
    const moduleName = moduleInfo.name;
    const modulePath = contextRootAbs(moduleName);

    if (!fs.existsSync(modulePath)) {
      return;
    }

    const moduleSourceFiles = project.getSourceFiles().filter((f) => {
      const fp = f.getFilePath();
      // Use path separator boundary to avoid matching sibling packages
      // whose names share a prefix (e.g. 'ui' matching 'ui-projection-compiler').
      return fp === modulePath || fp.startsWith(modulePath + path.sep);
    });

    moduleSourceFiles.forEach((file) => {
      const filePath = file.getFilePath();

      // Skip build artifacts in dist/ directories
      if (filePath.includes("/dist/") || filePath.includes("\\dist\\")) {
        return;
      }
      if (isIgnoredFile(filePath)) {
        return;
      }
      filesScanned += 1;

      const isTestDbl = isTestDoubleOrTest(filePath);

      const imports = file.getImportDeclarations();
      imports.forEach((imp) => {
        const moduleSpecifier = imp.getModuleSpecifierValue();

        if (isTestDbl) return;

        const matchedScope =
          matchingImportScope(moduleSpecifier, importScopes) ?? SCOPE;

        const subpathResult = isSubpathViolation(
          moduleName,
          moduleSpecifier,
          matchedScope,
          linterConfig,
        );
        if (subpathResult?.violation) {
          const message =
            subpathResult.enforcement === "error"
              ? `Subpath Violation in [${moduleName}]:\n File: ${path.relative(ROOT_DIR, filePath)}\n Package '${moduleName}' cannot import '${moduleSpecifier}' (${subpathResult.subpathType} subpath, enforcement: error)`
              : `Subpath Warning in [${moduleName}]:\n File: ${path.relative(ROOT_DIR, filePath)}\n Package '${moduleName}' imports '${moduleSpecifier}' (${subpathResult.subpathType} subpath, enforcement: warn)`;

          if (subpathResult.enforcement === "error") {
            errors.push(
              record("subpath-convention", filePath, moduleSpecifier, message),
            );
          } else {
            warnings.push(message);
          }
          return;
        }

        const scopedImport = matchingImportScope(moduleSpecifier, importScopes);
        const unscopedCandidate = scopedImport
          ? null
          : unscopedContextImport(moduleSpecifier, contextNames);
        const resolvedImportPath = imp
          .getModuleSpecifierSourceFile()
          ?.getFilePath();
        const unscopedImport =
          unscopedCandidate &&
          resolvedPathIsWorkspaceImport(resolvedImportPath, contextRoots)
            ? unscopedCandidate
            : null;
        const importedPkg = scopedImport
          ? moduleSpecifier.slice(scopedImport.length + 1).split("/")[0]
          : unscopedImport;
        const crossPkgSpecifier = scopedImport
          ? moduleSpecifier
          : unscopedImport
            ? `${SCOPE}/${unscopedImport}`
            : null;
        const crossPkgScope = scopedImport ?? SCOPE;
        if (importedPkg && importedPkg !== moduleName && crossPkgSpecifier) {
          if (
            isCrossPackageViolation(
              moduleName,
              crossPkgSpecifier,
              crossPkgScope,
              linterConfig,
              manifestGrants,
            )
          ) {
            errors.push(
              record(
                "cross-package-import",
                filePath,
                moduleSpecifier,
                `Boundary Violation in [${moduleName}]:
  File: ${path.relative(ROOT_DIR, filePath)}
  Illegal import from another module: '${moduleSpecifier}'
  Not declared in '${moduleName}' depends_on (manifest) nor allowed by linter-config (global_whitelist / package_rules).
              `.trim(),
              ),
            );
          }
        }

        const ctxLayers = layout?.contexts?.[moduleName]?.layers;
        const fileLayer = ctxLayers
          ? resolveFileHexagonalLayer(filePath, {
              contextRootAbs: modulePath,
              layerDirs: ctxLayers,
              layerNames: LAYER_NAMES,
            })
          : filePath.includes("/domain/")
            ? "domain"
            : filePath.includes("/application/")
              ? "application"
              : null;

        if (fileLayer === "domain") {
          const allowed = getLayerAllowedImports(
            ctxLayers
              ? path.join(modulePath, "src", fileLayer, "__layout_probe__.ts")
              : filePath,
            layerRules,
            SCOPE,
          );
          const domainFinding = (detail: string, rule: string) =>
            record(
              rule,
              filePath,
              moduleSpecifier,
              `Domain Violation in [${moduleName}]:
  Domain file: ${path.relative(ROOT_DIR, filePath)}
  ${detail}`.trim(),
            );

          if (
            !moduleSpecifier.startsWith("@") &&
            (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/"))
          ) {
            // AUD-011 hole 1: a relative specifier used to be waved through as
            // "within same package". It is now resolved and classified — only a
            // target inside this file's own layer (or one the layer's
            // allowed_imports cover) stays legal.
            const crossLayer = checkCrossLayerRelativeImport({
              filePath,
              moduleSpecifier,
              sourceLayer: "domain",
              allowed,
              scope: SCOPE,
              workspacesDir,
              layerNames: LAYER_NAMES,
              contextRootAbs: modulePath,
              layerDirs: ctxLayers,
            });
            if (crossLayer) {
              errors.push(domainFinding(crossLayer.detail, crossLayer.rule));
            }
          } else {
            const sourceFile = imp.getModuleSpecifierSourceFile();
            if (sourceFile) {
              const importPath = sourceFile.getFilePath();
              const isAllowed =
                importPathSatisfiesLayers(
                  importPath,
                  allowed,
                  SCOPE,
                  workspacesDir,
                ) || layoutTargetLayerAllowed(importPath, allowed);
              if (!isAllowed && !importPath.includes("/node_modules/")) {
                errors.push(
                  domainFinding(
                    `Cannot import from outside allowed layers: '${moduleSpecifier}'`,
                    "domain-layer-import",
                  ),
                );
              }
            }

            // AUD-011 holes 2 and 3. Neither resolves to an in-project source
            // file, so the check above can never see them: a builtin resolves to
            // nothing, an npm package into the excluded node_modules.
            const builtin = checkNodeBuiltinInLayer("domain", moduleSpecifier);
            if (builtin) {
              errors.push(domainFinding(builtin.detail, builtin.rule));
            } else if (!scopedImport && !unscopedImport) {
              const npmPackage = checkNpmPackageInDomain({
                moduleSpecifier,
                contextName: moduleName,
                scope: SCOPE,
                allowlist: linterConfig.domain_package_allowlist,
              });
              if (npmPackage) {
                errors.push(domainFinding(npmPackage.detail, npmPackage.rule));
              }
            }
          }
        }

        if (fileLayer === "application") {
          const allowed = getLayerAllowedImports(
            ctxLayers
              ? path.join(modulePath, "src", fileLayer, "__layout_probe__.ts")
              : filePath,
            layerRules,
            SCOPE,
          );
          const applicationFinding = (detail: string, rule: string) =>
            record(
              rule,
              filePath,
              moduleSpecifier,
              `Application Violation in [${moduleName}]:
  Application file: ${path.relative(ROOT_DIR, filePath)}
  ${detail}`.trim(),
            );

          // AUD-011 hole 1, application half: relative imports used to return
          // early as unconditionally allowed.
          if (
            moduleSpecifier.startsWith(".") ||
            moduleSpecifier.startsWith("/")
          ) {
            const crossLayer = checkCrossLayerRelativeImport({
              filePath,
              moduleSpecifier,
              sourceLayer: "application",
              allowed,
              scope: SCOPE,
              workspacesDir,
              contextRootAbs: modulePath,
              layerDirs: ctxLayers,
              // Deliberately NOT threading `isSharedKernelAllowed` here. That
              // flag short-circuits `${scope}/shared` to "allowed" for ANY
              // import path, which is sound for a package specifier (the grant
              // is "you may import the shared kernel") but vacuous for a
              // relative one: a relative path never resolves to another
              // workspace package's published entry point. Passing it would
              // make this rule a no-op for every project whose application
              // layer lists the shared kernel — i.e. all of them.
              layerNames: LAYER_NAMES,
            });
            if (crossLayer) {
              errors.push(
                applicationFinding(crossLayer.detail, crossLayer.rule),
              );
            }
            return;
          }

          // AUD-011 hole 2, application half. (Hole 3 — npm packages — is
          // domain-only by ADR-0054 §2c: application is the composition seam.)
          const builtin = checkNodeBuiltinInLayer(
            "application",
            moduleSpecifier,
          );
          if (builtin) {
            errors.push(applicationFinding(builtin.detail, builtin.rule));
          }

          const sourceFile = imp.getModuleSpecifierSourceFile();
          if (sourceFile) {
            const importPath = sourceFile.getFilePath();
            const isAllowed =
              importPathSatisfiesLayers(
                importPath,
                allowed,
                SCOPE,
                workspacesDir,
                isSharedKernelAllowed(layerRules),
              ) || layoutTargetLayerAllowed(importPath, allowed);
            if (!isAllowed && !importPath.includes("/node_modules/")) {
              errors.push(
                applicationFinding(
                  `Cannot import from outside allowed layers: '${moduleSpecifier}'`,
                  "application-layer-import",
                ),
              );
            }
          }
        }
      });
    });

    moduleSourceFiles.forEach((file) => {
      const filePath = file.getFilePath();
      if (filePath.includes("/dist/") || filePath.includes("\\dist\\")) return;
      if (isIgnoredFile(filePath)) return;

      const fileText = file.getFullText();
      const markerViolation = checkUnexpectedMarker(
        filePath,
        fileText,
        linterConfig,
      );
      if (markerViolation) {
        const message = `[${moduleName}]\n File: ${path.relative(ROOT_DIR, filePath)}\n ${markerViolation.message}`;
        if (markerViolation.enforcement === "error") {
          errors.push(
            record("server-marker-unexpected", filePath, "", message),
          );
        } else {
          warnings.push(message);
        }
      }
    });
  });

  // ─── Server Marker Backward Check (per-package) ───────────────────────────
  modules.forEach((moduleInfo) => {
    const moduleName = moduleInfo.name;
    const modulePath = contextRootAbs(moduleName);
    if (!fs.existsSync(modulePath)) return;

    const pkgJsonPath = path.join(modulePath, "package.json");
    if (!fs.existsSync(pkgJsonPath)) return;

    let packageJson: { name?: string; exports?: Record<string, unknown> };
    try {
      packageJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    } catch {
      return;
    }

    const packageName =
      packageJson.name?.replace(`${SCOPE}/`, "") ?? moduleName;

    const markerViolation = checkMissingMarker(
      modulePath,
      packageName,
      packageJson.exports ?? {},
      linterConfig,
      (filePath: string) => fs.readFileSync(filePath, "utf8"),
    );
    if (markerViolation) {
      const message = `[${packageName}]\n File: ${path.relative(ROOT_DIR, markerViolation.filePath)}\n ${markerViolation.message}`;
      if (markerViolation.enforcement === "error") {
        errors.push(
          record(
            "server-marker-missing",
            markerViolation.filePath,
            "",
            message,
          ),
        );
      } else {
        warnings.push(message);
      }
    }
  });

  // ─── Required-communication check (positive cross-context enforcement) ────
  // For every declared cross_context edge, the transport ports the emitter is
  // contracted to produce must exist. This is the positive complement to the
  // Boundary Violation check above: a strict project with no transport at all
  // passes the negative check but fails here, so `required_communication` guards
  // real code instead of being advisory.
  const crossContextEdges = (
    manifest as { cross_context?: CrossContextEdgeInput[] }
  ).cross_context;
  const commViolations = checkRequiredCommunication(
    crossContextEdges,
    PKG_ROOT_PATH,
    (p) => fs.existsSync(p),
    { advisory: false },
  );
  for (const v of commViolations) {
    const message = `Required Communication Violation:\n ${v.message}`;
    if (v.enforcement === "warn") {
      warnings.push(message);
    } else {
      errors.push({
        rule: "required-communication",
        file: v.missingPort,
        specifier: v.transport,
        message,
      });
    }
  }

  if (warnings.length > 0) {
    logger.warn("Subpath convention warnings (enforcement: warn):");
    warnings.forEach((w) => logger.warn(` - ${w}`));
  }

  return { errors, filesScanned };
}

// ─── Ratchet reporting ──────────────────────────────────────────────────────

/**
 * Apply the ratchet and decide the exit code.
 *
 * Only violations ABSENT from the baseline fail the run. Baselined ones are
 * counted, and stale entries (a baselined violation that no longer reproduces)
 * are named so the PR that fixed them can delete its own lines — the ADR-0054
 * burn-down discipline. Stale entries do not fail: the file is monotone-
 * decreasing by review, and failing here would block the very PR that fixed
 * something until it also re-ran the tool.
 */
function reportAndExit(violations: ViolationRecord[]): void {
  const { fresh, baselined, stale, expired } = partitionAgainstBaseline(
    violations,
    baselineEntries,
  );

  let introduced: ViolationRecord[] = [];
  let baselineGrowth: BaselineEntry[] = [];

  if (PR_DIFF) {
    const baseRef = resolveBaseRef(baseRefArg);
    if (!baseRef) {
      logger.error(
        "FATAL ERROR: --pr-diff requires --base-ref or GITHUB_BASE_REF. Refusing to report a clean per-PR diff that never ran.",
      );
      process.exit(EXIT_COULD_NOT_RUN);
    } else {
      const baselineRel = path
        .relative(ROOT_DIR, BASELINE_PATH)
        .split(path.sep)
        .join("/");
      const shown = showFileAtRef(ROOT_DIR, baseRef, baselineRel);
      if (shown.kind === "error") {
        logger.error(
          `FATAL ERROR: could not read base-ref baseline at ${baseRef}:${baselineRel}`,
        );
        logger.error(`  ${shown.message}`);
        process.exit(EXIT_COULD_NOT_RUN);
      }
      let baseBaseline: BaselineEntry[] = [];
      try {
        baseBaseline = parseBaseBaselineText(
          shown.kind === "ok" ? shown.text : null,
        );
      } catch (e) {
        logger.error(
          `FATAL ERROR: base-ref baseline at ${baseRef}:${baselineRel} could not be parsed.`,
        );
        logger.error(`  ${(e as Error).message}`);
        process.exit(EXIT_COULD_NOT_RUN);
      }
      let renameOutput: string;
      try {
        renameOutput = renameNameStatus(ROOT_DIR, baseRef);
      } catch (e) {
        logger.error(`FATAL ERROR: ${(e as Error).message}`);
        process.exit(EXIT_COULD_NOT_RUN);
      }
      const renames = parseRenameNameStatus(renameOutput);
      const pr = computePrDiff({
        currentViolations: violations,
        currentBaseline: baselineEntries,
        baseBaseline,
        renames,
      });
      introduced = pr.introduced;
      baselineGrowth = pr.baselineGrowth;
      if (renames.length > 0) {
        logger.info(
          `Ratchet --pr-diff: remapped ${renames.length} rename(s) against ${baseRef}.`,
        );
      }
    }
  }

  if (commentFileArg) {
    const body = formatPrComment({
      introduced,
      baselineGrowth,
      expired,
    });
    fs.writeFileSync(commentFileArg, body ?? "", "utf8");
  }

  if (JSON_MODE) {
    process.stdout.write(
      `${JSON.stringify({
        fresh,
        baselined,
        stale,
        expired,
        introduced,
        baselineGrowth,
      })}\n`,
    );
  }

  if (baselined.length > 0) {
    logger.info(
      `Ratchet: ${baselined.length} known violation(s) suppressed by ${path.relative(ROOT_DIR, BASELINE_PATH)}.`,
    );
  }

  if (stale.length > 0) {
    logger.warn(
      `Ratchet: ${stale.length} baseline ${stale.length === 1 ? "entry no longer reproduces" : "entries no longer reproduce"} — delete them from ${path.relative(ROOT_DIR, BASELINE_PATH)}:`,
    );
    stale.forEach((entry) =>
      logger.warn(
        ` - ${entry.rule} ${entry.file}${entry.specifier ? ` (${entry.specifier})` : ""}`,
      ),
    );
  }

  if (expired.length > 0) {
    logger.error(
      `Ratchet: ${expired.length} expired suppression${expired.length === 1 ? "" : "s"} — remove or renew them:`,
    );
    expired.forEach((entry) =>
      logger.error(
        ` - ${entry.rule} ${entry.file}${entry.specifier ? ` (${entry.specifier})` : ""} expired ${entry.expires}${entry.reason ? ` — ${entry.reason}` : ""}`,
      ),
    );
  }

  if (baselineGrowth.length > 0) {
    logger.error(
      `Ratchet: baseline grew by ${baselineGrowth.length} ${baselineGrowth.length === 1 ? "entry" : "entries"} against the base branch. The baseline may only shrink:`,
    );
    baselineGrowth.forEach((entry) =>
      logger.error(
        ` - ${entry.rule} ${entry.file}${entry.specifier ? ` (${entry.specifier})` : ""}`,
      ),
    );
  }

  if (fresh.length > 0) {
    logger.error("Architectural Integrity Check Failed. Found violations:");
    fresh.forEach((e) => logger.error(` - ${e.message}`));
    if (baselineEntries.length > 0) {
      logger.error(
        "These are NEW violations, measured against the committed baseline. The baseline may only shrink — fix the violation instead of adding an entry.",
      );
    }
  }

  if (fresh.length > 0 || expired.length > 0 || baselineGrowth.length > 0) {
    process.exit(1);
  }

  // Name what was actually checked (RCA #8: the old blanket "compliant
  // with manifest.yaml" claimed manifest governance the linter didn't do).
  logger.info(
    "Architecture is compliant. Checked: cross-context imports (manifest depends_on + shared-kernel types + linter-config), layer rules (incl. cross-layer relative imports, node builtins in domain/application, npm packages in domain), subpath conventions, server markers, required communication.",
  );
}

function abortIfVacuous(filesScanned: number): void {
  logger.info(`Files scanned: ${filesScanned}`);
  if (filesScanned > 0) return;
  logger.error("FATAL ERROR: Zero resolvable source files were scanned.");
  logger.error(
    "  The linter did not check any code — this is not a pass. Check that context directories exist, tsconfig includes them, and layout.yaml roots are correct.",
  );
  process.exit(EXIT_COULD_NOT_RUN);
}

/** `--update-baseline`: rewrite the file from this run, then exit 0. */
function writeBaseline(violations: ViolationRecord[]): void {
  let previous: BaselineEntry[] = [];
  if (fs.existsSync(BASELINE_PATH)) {
    try {
      previous = parseBaseline(fs.readFileSync(BASELINE_PATH, "utf8")).entries;
    } catch (e) {
      logger.error(
        `FATAL ERROR: --update-baseline could not parse ${BASELINE_PATH}`,
      );
      logger.error(`  ${(e as Error).message}`);
      process.exit(EXIT_COULD_NOT_RUN);
    }
  }
  const merged = mergeSuppressionMetadata(violations, previous);
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, serializeBaseline(merged), "utf8");
  logger.info(
    `Wrote ${merged.length} violation(s) to ${path.relative(ROOT_DIR, BASELINE_PATH)}. Review the diff: this file may only shrink.`,
  );
}

// ─── Entry Point ────────────────────────────────────────────────────────────

logger.info("Running Architectural Integrity Linter...");
logger.info(`Project root: ${ROOT_DIR}`);
logger.info(`Scope: ${SCOPE}`);
const integrity = checkArchitecturalIntegrity();
const filesScanned = integrity.filesScanned;
let foundViolations = integrity.errors;
abortIfVacuous(filesScanned);
if (STAGED) {
  let staged: string[];
  try {
    staged = stagedFiles(ROOT_DIR);
  } catch (e) {
    logger.error(`FATAL ERROR: ${(e as Error).message}`);
    process.exit(EXIT_COULD_NOT_RUN);
  }
  const stagedSet = new Set(staged);
  foundViolations = foundViolations.filter((v) => stagedSet.has(v.file));
  logger.info(
    `Ratchet --staged: ${staged.length} staged path(s), ${foundViolations.length} finding(s) on staged files.`,
  );
}
if (UPDATE_BASELINE) {
  writeBaseline(foundViolations);
} else {
  reportAndExit(foundViolations);
}
