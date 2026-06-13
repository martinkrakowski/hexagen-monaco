#!/usr/bin/env node
/// <reference types='node' />
import * as fsPromises from "fs/promises";
import * as fs from "fs";
import { Project } from "ts-morph";
import * as yaml from "js-yaml";
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
export type {
  SubpathConvention,
  SubpathConventionConfig,
  LinterConfig,
  MarkerExclusion,
} from "./subpath-violation.js";
export type {
  ServerMarkerViolation,
  UnexpectedMarkerViolation,
  MissingMarkerViolation,
  BrokenServerExportViolation,
} from "./server-marker-violation.js";
export type { RequiredCommunicationViolation } from "./required-communication-violation.js";

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

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface LayerRules {
  shared_kernel?: {
    package: string;
    allowed_in_all_layers?: boolean;
  };
  layers?: {
    [layer: string]: {
      access_rule: string;
      allowed_imports?: string[];
    };
  };
  cross_package_rules?: {
    package: string;
    cannot_import?: string[];
  }[];
}

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

let layerRules: LayerRules;
try {
  const layerRulesContent = await fsPromises.readFile(LAYER_RULES_PATH, "utf8");
  layerRules = (yaml.load(layerRulesContent) as LayerRules) ?? {};
} catch {
  logger.warn(
    `Could not load layer-rules.yaml from ${LAYER_RULES_PATH}, using defaults`,
  );
  layerRules = {};
}

let linterConfig: LinterConfig;
try {
  const linterConfigContent = await fsPromises.readFile(
    LINTER_CONFIG_PATH,
    "utf8",
  );
  linterConfig = (yaml.load(linterConfigContent) as LinterConfig) ?? {};
} catch {
  logger.warn(
    `Could not load linter-config.yaml from ${LINTER_CONFIG_PATH}, using defaults`,
  );
  linterConfig = {};
}

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

function getLayerAllowedImports(filePath: string): string[] {
  const layers = layerRules?.layers;
  if (!layers) return ["domain", SCOPE];

  for (const [layerName, layerDef] of Object.entries(layers)) {
    if (layerName.includes("/")) {
      const [pkgName, layerPath] = layerName.split("/");
      if (
        filePath.includes(`/${pkgName}/`) &&
        filePath.includes(`/${layerPath}/`)
      ) {
        return layerDef.allowed_imports ?? ["domain", `${SCOPE}/shared`];
      }
    }
  }

  for (const [layerName, layerDef] of Object.entries(layers)) {
    if (!layerName.includes("/")) {
      if (filePath.includes(`/${layerName}/`)) {
        return layerDef.allowed_imports ?? ["domain", `${SCOPE}/shared`];
      }
    }
  }

  return layers.application?.allowed_imports ?? ["domain", `${SCOPE}/shared`];
}

function isSharedKernelAllowed(): boolean {
  return layerRules?.shared_kernel?.allowed_in_all_layers ?? true;
}

export { isSubpathViolation } from "./subpath-violation.js";
export {
  buildManifestImportGrants,
  isCrossPackageViolation,
  isGlobalWhitelisted,
} from "./cross-package-violation.js";
export type { ManifestImportGrants } from "./cross-package-violation.js";

// ─── Main Lint Check ────────────────────────────────────────────────────────

function checkArchitecturalIntegrity() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const modules = manifest.bounded_contexts ?? [];

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
            errors.push(message);
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
                `Boundary Violation in [${moduleName}]:
  File: ${path.relative(ROOT_DIR, filePath)}
  Illegal import from another module: '${moduleSpecifier}'
  Not declared in '${moduleName}' depends_on (manifest) nor allowed by linter-config (global_whitelist / package_rules).
              `.trim(),
              );
            }
          }
        }

        if (filePath.includes("/domain/")) {
          if (
            !moduleSpecifier.startsWith("@") &&
            (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/"))
          ) {
            // Relative import within same package - allowed
          } else {
            const allowed = getLayerAllowedImports(filePath);
            const sourceFile = imp.getModuleSpecifierSourceFile();
            if (sourceFile) {
              const importPath = sourceFile.getFilePath();
              const isAllowed = allowed.some((a) => {
                if (a.startsWith("@")) {
                  const pkgName = a.split("/")[1];
                  return (
                    importPath.includes(`/${workspacesDir}/${pkgName}/`) ||
                    importPath.includes(`\\${workspacesDir}\\${pkgName}\\`)
                  );
                }
                return (
                  importPath.includes(`/${a}/`) ||
                  importPath.includes(`\\${a}\\`)
                );
              });
              if (!isAllowed && !importPath.includes("/node_modules/")) {
                errors.push(
                  `Domain Violation in [${moduleName}]:
  Domain file: ${path.relative(ROOT_DIR, filePath)}
  Cannot import from outside allowed layers: '${moduleSpecifier}'
              `.trim(),
                );
              }
            }
          }
        }

        if (filePath.includes("/application/")) {
          // Allow relative imports within the same package
          if (
            moduleSpecifier.startsWith(".") ||
            moduleSpecifier.startsWith("/")
          ) {
            return;
          }

          const allowed = getLayerAllowedImports(filePath);
          const sourceFile = imp.getModuleSpecifierSourceFile();
          if (sourceFile) {
            const importPath = sourceFile.getFilePath();
            const isAllowed = allowed.some((a) => {
              if (a === `${SCOPE}/shared` && isSharedKernelAllowed())
                return true;
              if (a.startsWith("@")) {
                const pkgName = a.split("/")[1];
                return (
                  importPath.includes(`/${workspacesDir}/${pkgName}/`) ||
                  importPath.includes(`\\${workspacesDir}\\${pkgName}\\`)
                );
              }
              return (
                importPath.includes(`/${a}/`) || importPath.includes(`\\${a}\\`)
              );
            });
            if (!isAllowed && !importPath.includes("/node_modules/")) {
              errors.push(
                `Application Violation in [${moduleName}]:
  Application file: ${path.relative(ROOT_DIR, filePath)}
  Cannot import from outside allowed layers: '${moduleSpecifier}'
              `.trim(),
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
          errors.push(message);
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
        errors.push(message);
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
    errors.push(`Required Communication Violation:\n ${v.message}`);
  }

  if (warnings.length > 0) {
    logger.warn("Subpath convention warnings (enforcement: warn):");
    warnings.forEach((w) => logger.warn(` - ${w}`));
  }

  if (errors.length > 0) {
    logger.error("Architectural Integrity Check Failed. Found violations:");
    errors.forEach((e) => logger.error(` - ${e}`));
    process.exit(1);
  } else {
    // Name what was actually checked (RCA #8: the old blanket "compliant
    // with manifest.yaml" claimed manifest governance the linter didn't do).
    logger.info(
      "Architecture is compliant. Checked: cross-context imports (manifest depends_on + shared-kernel types + linter-config), layer rules, subpath conventions, server markers, required communication.",
    );
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

logger.info("Running Architectural Integrity Linter...");
logger.info(`Project root: ${ROOT_DIR}`);
logger.info(`Scope: ${SCOPE}`);
checkArchitecturalIntegrity();

export type { LoggerPort } from "./logger.js";
export { createConsoleLogger } from "./logger.js";
