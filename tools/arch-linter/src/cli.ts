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
import { resolveLintScope } from "./resolve-scope.js";
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
} from "./layer-purity-violation.js";
import type { BaselineEntry, ViolationRecord } from "./ratchet-baseline.js";
import {
  DEFAULT_BASELINE_RELATIVE_PATH,
  parseBaseline,
  partitionAgainstBaseline,
  serializeBaseline,
} from "./ratchet-baseline.js";

const logger = createConsoleLogger();

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

  // C. Walk up from cwd() to find .architecture/manifest.yaml
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".architecture", "manifest.yaml"))) {
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
  process.exit(1);
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
const TSCONFIG_PATH = path.join(ROOT_DIR, "tsconfig.base.json");

// ─── Ratchet baseline (ADR-0054 §1) ─────────────────────────────────────────
//
// `--baseline <path>` overrides the location; `--update-baseline` rewrites the
// file from the current run instead of enforcing against it (seeding, and
// deliberate regeneration). The baseline is resolved from ROOT_DIR so a
// generated project inherits the same convention with zero configuration.
const baselineArgIndex = process.argv.indexOf("--baseline");
const BASELINE_PATH =
  baselineArgIndex !== -1 && process.argv[baselineArgIndex + 1]
    ? path.resolve(process.argv[baselineArgIndex + 1])
    : path.join(ROOT_DIR, ...DEFAULT_BASELINE_RELATIVE_PATH.split("/"));
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

// ─── Load Manifest (Strict Mode) ────────────────────────────────────────────

if (!fs.existsSync(MANIFEST_PATH)) {
  logger.error(
    `FATAL ERROR: Architecture manifest not found at ${MANIFEST_PATH}`,
  );
  logger.error("The linter requires a manifest to validate against. Aborting.");
  process.exit(1);
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
  process.exit(1);
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
      process.exit(1);
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
    process.exit(1);
  }
}

const baselineEntries = UPDATE_BASELINE ? [] : loadBaseline(BASELINE_PATH);

// ─── TypeScript Project ─────────────────────────────────────────────────────

const project = new Project({
  tsConfigFilePath: TSCONFIG_PATH,
});

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

function checkArchitecturalIntegrity() {
  const errors: ViolationRecord[] = [];
  const warnings: string[] = [];
  const modules = manifest.bounded_contexts ?? [];

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
    const modulePath = path.join(PKG_ROOT_PATH, moduleName);

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

      const isTestDbl = isTestDoubleOrTest(filePath);

      const imports = file.getImportDeclarations();
      imports.forEach((imp) => {
        const moduleSpecifier = imp.getModuleSpecifierValue();

        if (isTestDbl) return;

        const subpathResult = isSubpathViolation(
          moduleName,
          moduleSpecifier,
          SCOPE,
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

        if (moduleSpecifier.startsWith(SCOPE + "/")) {
          const importedPkg = moduleSpecifier.split("/")[1];
          if (importedPkg && importedPkg !== moduleName) {
            if (
              isCrossPackageViolation(
                moduleName,
                moduleSpecifier,
                SCOPE,
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
        }

        if (filePath.includes("/domain/")) {
          const allowed = getLayerAllowedImports(filePath, layerRules, SCOPE);
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
            });
            if (crossLayer) {
              errors.push(domainFinding(crossLayer.detail, crossLayer.rule));
            }
          } else {
            const sourceFile = imp.getModuleSpecifierSourceFile();
            if (sourceFile) {
              const importPath = sourceFile.getFilePath();
              const isAllowed = importPathSatisfiesLayers(
                importPath,
                allowed,
                SCOPE,
                workspacesDir,
              );
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
            } else {
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

        if (filePath.includes("/application/")) {
          const allowed = getLayerAllowedImports(filePath, layerRules, SCOPE);
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
            const isAllowed = importPathSatisfiesLayers(
              importPath,
              allowed,
              SCOPE,
              workspacesDir,
              isSharedKernelAllowed(layerRules),
            );
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
    const modulePath = path.join(PKG_ROOT_PATH, moduleName);
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
  );
  for (const v of commViolations) {
    errors.push({
      rule: "required-communication",
      file: v.missingPort,
      specifier: v.transport,
      message: `Required Communication Violation:\n ${v.message}`,
    });
  }

  if (warnings.length > 0) {
    logger.warn("Subpath convention warnings (enforcement: warn):");
    warnings.forEach((w) => logger.warn(` - ${w}`));
  }

  return errors;
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
  const { fresh, baselined, stale } = partitionAgainstBaseline(
    violations,
    baselineEntries,
  );

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

  if (fresh.length > 0) {
    logger.error("Architectural Integrity Check Failed. Found violations:");
    fresh.forEach((e) => logger.error(` - ${e.message}`));
    if (baselineEntries.length > 0) {
      logger.error(
        "These are NEW violations, measured against the committed baseline. The baseline may only shrink — fix the violation instead of adding an entry.",
      );
    }
    process.exit(1);
  }

  // Name what was actually checked (RCA #8: the old blanket "compliant
  // with manifest.yaml" claimed manifest governance the linter didn't do).
  logger.info(
    "Architecture is compliant. Checked: cross-context imports (manifest depends_on + shared-kernel types + linter-config), layer rules (incl. cross-layer relative imports, node builtins in domain/application, npm packages in domain), subpath conventions, server markers, required communication.",
  );
}

/** `--update-baseline`: rewrite the file from this run, then exit 0. */
function writeBaseline(violations: ViolationRecord[]): void {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, serializeBaseline(violations), "utf8");
  logger.info(
    `Wrote ${violations.length} violation(s) to ${path.relative(ROOT_DIR, BASELINE_PATH)}. Review the diff: this file may only shrink.`,
  );
}

// ─── Entry Point ────────────────────────────────────────────────────────────

logger.info("Running Architectural Integrity Linter...");
logger.info(`Project root: ${ROOT_DIR}`);
logger.info(`Scope: ${SCOPE}`);
const foundViolations = checkArchitecturalIntegrity();
if (UPDATE_BASELINE) {
  writeBaseline(foundViolations);
} else {
  reportAndExit(foundViolations);
}
