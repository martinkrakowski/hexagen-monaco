/**
 * Library barrel for @hexagen/arch-linter (GOD-002 split).
 *
 * This module is SIDE-EFFECT-FREE: importing the package re-exports the pure
 * checkers/types below and does NOT run the linter. The CLI bootstrap (project-
 * root discovery, manifest load, ts-morph project, `checkArchitecturalIntegrity`
 * + `process.exit`) lives in `./cli.ts`, which is the package `bin`
 * (`hexagen-lint` → `dist/cli.js`). Keep it that way: nothing here may perform
 * top-level I/O, read `process.argv`/`process.env`, or call `process.exit`.
 */
export type {
  SubpathConvention,
  SubpathConventionConfig,
  LinterConfig,
  MarkerExclusion,
} from "./subpath-violation.js";
export { isSubpathViolation } from "./subpath-violation.js";

export type {
  ServerMarkerViolation,
  UnexpectedMarkerViolation,
  MissingMarkerViolation,
  BrokenServerExportViolation,
} from "./server-marker-violation.js";
export {
  hasServerOnlyMarker,
  checkUnexpectedMarker,
  checkMissingMarker,
  resolveServerBarrelPath,
} from "./server-marker-violation.js";

export type {
  RequiredCommunicationViolation,
  CrossContextEdgeInput,
} from "./required-communication-violation.js";
export { checkRequiredCommunication } from "./required-communication-violation.js";

export type { ManifestImportGrants } from "./cross-package-violation.js";
export {
  buildManifestImportGrants,
  isCrossPackageViolation,
  isGlobalWhitelisted,
} from "./cross-package-violation.js";

export type { LayerRules } from "./layer-import-violation.js";
export {
  getLayerAllowedImports,
  importPathSatisfiesLayers,
  isSharedKernelAllowed,
} from "./layer-import-violation.js";

export type {
  LayerPurityRule,
  LayerPurityViolation,
  DomainPackageAllowlistEntry,
  CrossLayerRelativeInput,
  DomainPackageInput,
  FileLayerResolution,
} from "./layer-purity-violation.js";
export {
  DEFAULT_LAYER_NAMES,
  checkCrossLayerRelativeImport,
  checkNodeBuiltinInLayer,
  checkNpmPackageInDomain,
  detectLayer,
  resolveFileHexagonalLayer,
  isDomainPackageAllowed,
  isNodeBuiltinSpecifier,
  isRelativeSpecifier,
  isWorkspaceSpecifier,
  npmPackageNameOf,
  resolveRelativeImportPath,
} from "./layer-purity-violation.js";

export type {
  BaselineEntry,
  BaselineEntryField,
  BaselineFile,
  PartitionResult,
  ViolationRecord,
} from "./ratchet-baseline.js";
export {
  BASELINE_ENTRY_FIELDS,
  BASELINE_VERSION,
  DEFAULT_BASELINE_RELATIVE_PATH,
  isSuppressionExpired,
  mergeSuppressionMetadata,
  parseBaseline,
  parseExpiresDate,
  partitionAgainstBaseline,
  serializeBaseline,
  violationKey,
} from "./ratchet-baseline.js";

export type { PrDiffInput, PrDiffResult, Rename } from "./pr-diff.js";
export {
  computePrDiff,
  formatPrComment,
  parseBaseBaselineText,
  parseRenameNameStatus,
  remapEntry,
} from "./pr-diff.js";

export type { OptionalYamlConfig } from "./optional-yaml-config.js";
export { loadOptionalYamlConfig } from "./optional-yaml-config.js";

export { resolveLintScope } from "./resolve-scope.js";
export {
  matchingImportScope,
  resolvedPathIsWorkspaceImport,
  scopesToTry,
  unscopedContextImport,
} from "./resolve-scope.js";

export type {
  LayoutConfig,
  ContextLayout,
  HexagonalLayerName,
  LayoutParseResult,
} from "./layout-config.js";
export {
  HEXAGONAL_LAYER_NAMES,
  LayoutConfigSchema,
  isEmptyLayout,
  loadLayoutConfig,
  matchesIgnorePattern,
  parseLayoutConfig,
} from "./layout-config.js";

export type {
  ContextDeclarationInput,
  ContextDeclarationViolation,
  CheckContextDeclarationsInput,
  DeclarationSection,
  DeclaredElement,
} from "./context-declaration-violation.js";
export {
  ADVISORY_DECLARATION_SECTIONS,
  ENFORCED_DECLARATION_SECTIONS,
  checkContextDeclarations,
  collectDeclaredElements,
  collectExportedNames,
} from "./context-declaration-violation.js";

export type { LoggerPort } from "./logger.js";
export { createConsoleLogger } from "./logger.js";
