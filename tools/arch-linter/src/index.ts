/// <reference types='node' />
import * as fsPromises from "fs/promises";
import * as fs from "fs";
import { Project } from "ts-morph";
import * as yaml from "js-yaml";
import path from "node:path";
import { createConsoleLogger } from "./logger.js";
import type { Manifest } from "@hexagen/sync";

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

interface LinterConfig {
  global_whitelist?: string[];
  package_rules?: {
    name: string;
    restricted_to?: string[];
    cannot_import?: string[];
  }[];
  test_double_rules?: {
    paths?: string[];
    allowed_cross_package_imports?: boolean;
  };
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
  const manifestContent = await fsPromises.readFile(MANIFEST_PATH, "utf8");
  manifest = (yaml.load(manifestContent) as Manifest) ?? {
    bounded_contexts: [],
  };
} catch (e) {
  logger.error(
    `FATAL ERROR: Could not parse architecture manifest from ${MANIFEST_PATH}`,
  );
  process.exit(1);
}

// ─── Dynamic Scope and Workspace Path ───────────────────────────────────────

const SCOPE = manifest.scope ? `@${manifest.scope}` : "@hexagen";

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

function isGlobalWhitelisted(moduleSpecifier: string): boolean {
  const whitelist = linterConfig.global_whitelist ?? [`${SCOPE}/shared`];
  return whitelist.some((pattern) => {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -2);
      return moduleSpecifier.startsWith(prefix);
    }
    return moduleSpecifier === pattern;
  });
}

function getPackageRestrictions(packageName: string): {
  restrictedTo: string[];
  cannotImport: string[];
  allowedImports: string[];
} {
  const pkgRule = linterConfig.package_rules?.find(
    (r) => r.name === packageName,
  );
  return {
    restrictedTo: pkgRule?.restricted_to ?? [],
    cannotImport: pkgRule?.cannot_import ?? [],
    allowedImports:
      (pkgRule as { allowed_imports?: string[] })?.allowed_imports ?? [],
  };
}

function isCrossPackageViolation(
  fromPackage: string,
  moduleSpecifier: string,
): boolean {
  if (!moduleSpecifier.startsWith(SCOPE)) return false;
  if (isGlobalWhitelisted(moduleSpecifier)) return false;

  const importedPkg = moduleSpecifier.split("/")[1];
  if (!importedPkg || importedPkg === fromPackage) return false;

  const { cannotImport, allowedImports } = getPackageRestrictions(fromPackage);
  if (cannotImport.includes(importedPkg)) return true;

  if (allowedImports.length > 0) {
    const isAllowed = allowedImports.some((allowed) => {
      if (allowed.endsWith("/**")) {
        return moduleSpecifier.startsWith(allowed.slice(0, -2));
      }
      return (
        moduleSpecifier === allowed || moduleSpecifier.startsWith(allowed + "/")
      );
    });
    if (isAllowed) return false;
  }

  if (
    linterConfig.package_rules?.some(
      (r) =>
        r.name === fromPackage && r.restricted_to && r.restricted_to.length > 0,
    )
  ) {
    const { restrictedTo } = getPackageRestrictions(fromPackage);
    return !restrictedTo.some((allowed) => {
      if (allowed.endsWith("/**")) {
        return moduleSpecifier.startsWith(allowed.slice(0, -2));
      }
      return (
        moduleSpecifier === allowed || moduleSpecifier.startsWith(allowed + "/")
      );
    });
  }

  return true;
}

function getLayerAllowedImports(filePath: string): string[] {
  const layers = layerRules?.layers;
  if (!layers) return ["domain", SCOPE];

  for (const [layerName, layerDef] of Object.entries(layers)) {
    if (filePath.includes(`/${layerName}/`)) {
      return layerDef.allowed_imports ?? ["domain", `${SCOPE}/shared`];
    }
  }

  return layers.application?.allowed_imports ?? ["domain", `${SCOPE}/shared`];
}

function isSharedKernelAllowed(): boolean {
  return layerRules?.shared_kernel?.allowed_in_all_layers ?? true;
}

// ─── Main Lint Check ────────────────────────────────────────────────────────

function checkArchitecturalIntegrity() {
  const errors: string[] = [];
  const modules = manifest.bounded_contexts ?? [];

  modules.forEach((moduleInfo) => {
    const moduleName = moduleInfo.name;
    const modulePath = path.join(PKG_ROOT_PATH, moduleName);

    if (!fs.existsSync(modulePath)) {
      return;
    }

    const moduleSourceFiles = project
      .getSourceFiles()
      .filter((f) => f.getFilePath().startsWith(modulePath));

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

        if (moduleSpecifier.startsWith(SCOPE)) {
          const importedPkg = moduleSpecifier.split("/")[1];
          if (importedPkg && importedPkg !== moduleName) {
            if (isCrossPackageViolation(moduleName, moduleSpecifier)) {
              errors.push(
                `Boundary Violation in [${moduleName}]:
  File: ${path.relative(ROOT_DIR, filePath)}
  Illegal import from another module: '${moduleSpecifier}'
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
  });

  if (errors.length > 0) {
    logger.error("Architectural Integrity Check Failed. Found violations:");
    errors.forEach((e) => logger.error(` - ${e}`));
    process.exit(1);
  } else {
    logger.info("Architecture is compliant with manifest.yaml.");
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

logger.info("Running Architectural Integrity Linter...");
logger.info(`Project root: ${ROOT_DIR}`);
logger.info(`Scope: ${SCOPE}`);
checkArchitecturalIntegrity();

export type { LoggerPort } from "./logger.js";
export { createConsoleLogger } from "./logger.js";
