/**
 * Full type definitions for .architecture/manifest.yaml
 *
 * This models the complete manifest structure used by HexaGen Monaco.
 * The sync engine, generators, and linters all consume this type.
 */

// =============================================================================
// Domain Layer Types
// =============================================================================

export interface DomainLayer {
  entities?: string[];
  value_objects?: string[];
  ports?: {
    in?: string[];
    out?: string[];
  };
}

// =============================================================================
// Application Layer Types
// =============================================================================

export interface ApplicationPorts {
  in?: string[];
  out?: string[];
}

export interface ApplicationLayer {
  use_cases?: string[];
  ports?: ApplicationPorts;
  factories?: string[];
}

// =============================================================================
// Infrastructure Layer Types
// =============================================================================

export interface InfrastructureLayer {
  adapters?: string[];
}

// =============================================================================
// Bounded Context Types
// =============================================================================

export type BoundedContextType =
  | "shared-kernel"
  | "core"
  | "supporting"
  | "driver";

export interface BoundedContextLayers {
  domain?: DomainLayer;
  application?: ApplicationLayer;
  infrastructure?: InfrastructureLayer;
}

export interface BoundedContextGenerator {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /**
   * Per-context override merged on top of workspaceDefaults.tsConfig.
   * Use for packages with non-standard build settings (e.g. CLI tools
   * needing emitDeclarationOnly: false, React packages needing jsx).
   *
   * See ADR-0024 §"Phase 2" — three-level merge cascade:
   *   per-context override > workspaceDefaults > generator built-in fallback.
   */
  tsConfig?: TsConfigTemplate;
  /** Per-context override merged on top of workspaceDefaults.packageJson. */
  packageJson?: Record<string, unknown>;
  /**
   * Per-context override merged on top of workspaceDefaults.eslint.
   * Follows the same three-level cascade as tsConfig / packageJson.
   * See sync-engine-unified-scaffolding plan §Phase 4.
   */
  eslint?: EslintConfig;
  /**
   * Per-context stub-naming override. Stub **templates** are intentionally
   * global-only (declared at `generator.sync.stubs.templates`); only the
   * filename/path conventions may vary per context.
   * See sync-engine-unified-scaffolding plan §Phase 1.
   */
  stubs?: {
    naming?: StubNaming;
  };
}

export interface BoundedContextWiring {
  description?: string;
}

export interface BoundedContext {
  name: string;
  type?: BoundedContextType;
  description?: string;
  layers?: BoundedContextLayers;
  depends_on?: string[];
  driver_for?: string;
  wiring?: string[];
  generator?: BoundedContextGenerator;
  packageJson?: Record<string, unknown>;
}

// =============================================================================
// App Types
// =============================================================================

export type AppDriver = "next.js" | "fastify" | "express" | "cli";

/**
 * Framework identifier consumed by the unified apps generator
 * (see `sync-engine-unified-scaffolding` plan §Phase 3).
 *
 * Distinct from the legacy {@link AppDriver} union:
 *   - adds `"plain-ts"` (a framework-agnostic TS entry point)
 *   - drops `"cli"` (CLIs are modelled as plain-ts apps going forward)
 *
 * Kept as a separate type so existing manifest entries using `driver` continue
 * to type-check; new entries should prefer `framework`.
 */
export type AppFramework = "next.js" | "fastify" | "express" | "plain-ts";

export interface App {
  name: string;
  /** Legacy field — retained for backward compatibility. New entries should use `framework`. */
  driver?: AppDriver;
  /**
   * Framework used to scaffold this app. Consumed by the apps generator to
   * select a template from `generator.sync.apps.frameworks[<framework>]`.
   */
  framework?: AppFramework;
  /** Framework version pin (e.g. `"16.x"` for Next.js). Informational; not enforced. */
  version?: string;
  description?: string;
  depends_on?: string[];
}

// =============================================================================
// Monorepo Configuration Types
// =============================================================================

export interface ESLintConfig {
  extends?: string[];
  rules?: Record<string, unknown>;
}

export interface TSConfigCompilerOptions {
  target?: string;
  lib?: string[];
  module?: string;
  moduleResolution?: string;
  strict?: boolean;
  esModuleInterop?: boolean;
  skipLibCheck?: boolean;
  forceConsistentCasingInFileNames?: boolean;
  composite?: boolean;
  baseUrl?: string;
  resolveJsonModule?: boolean;
  isolatedModules?: boolean;
  jsx?: string;
  declaration?: boolean;
  declarationMap?: boolean;
  emitDeclarationOnly?: boolean;
  rootDir?: string;
  outDir?: string;
  tsBuildInfoFile?: string;
  paths?: Record<string, string[]>;
}

export interface TSConfigRoot {
  compilerOptions?: TSConfigCompilerOptions;
  include?: string[];
  exclude?: string[];
  references?: Array<{ path: string }>;
}

/**
 * Schema for tsconfig.json templates and per-context overrides.
 * Mirrors the structure of tsconfig.json itself.
 *
 * More permissive than {@link TSConfigRoot} — `compilerOptions` is a bag of
 * unknown values so manifest authors may add arbitrary TS compiler options
 * without having to extend the typed schema first.
 *
 * Introduced by ADR-0024 Phase 2 as the canonical override shape.
 */
export interface TsConfigTemplate {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
  references?: Array<{ path: string }>;
}

export interface WorkspaceDefaults {
  /**
   * Default tsconfig template applied to all packages. Per-context overrides
   * in `bounded_contexts[].generator.tsConfig` are merged on top.
   */
  tsConfig?: TsConfigTemplate;
  packageJson?: Record<string, unknown>;
  /**
   * Default eslint config applied to all packages. Per-context overrides in
   * `bounded_contexts[].generator.eslint` are merged on top.
   * See sync-engine-unified-scaffolding plan §Phase 4.
   */
  eslint?: EslintConfig;
}

export interface TurboPipeline {
  dependsOn?: string[];
  outputs?: string[];
  cache?: boolean;
  persistent?: boolean;
}

export interface TurboConfig {
  globalDependencies?: string[];
  pipeline?: Record<string, TurboPipeline>;
}

export interface MonorepoRoot {
  hoistDevDependencies?: boolean;
  noInternalDeps?: boolean;
}

export interface MonorepoConfig {
  packageManager?: string;
  linker?: string;
  buildTool?: string;
  workspaces?: string[];
  root?: MonorepoRoot;
  eslint?: ESLintConfig;
  tsConfigRootFile?: string;
  tsConfigRoot?: TSConfigRoot;
  workspaceDefaults?: WorkspaceDefaults;
  turboConfig?: TurboConfig;
  /**
   * Root-level file templates (package.json, tsconfig.base.json, turbo.json).
   * Consumed by the `generateRootFiles` generator.
   * See sync-engine-unified-scaffolding plan §Phase 2.
   */
  rootFiles?: RootFilesConfig;
  /**
   * Templates for the generated `.architecture/**` content in target monorepos.
   * Consumed by the `generateArchitectureFiles` generator.
   * See sync-engine-unified-scaffolding plan §Phase 2.
   */
  archInvariants?: ArchInvariantsConfig;
}

// =============================================================================
// Generator Configuration Types
// =============================================================================

export interface LayerConfig {
  folder: string;
  subfolders?: string[];
}

export interface PackageJsonConfig {
  mergeStrategy?: "preserveExisting" | "overwrite" | "merge";
  protectedKeys?: string[];
  injectIfMissing?: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

export interface SyncConfig {
  idempotent?: boolean;
  createOnlyIfMissing?: boolean;
  nonDestructive?: boolean;
  protectedRootFiles?: string[];
  layers?: Record<string, LayerConfig>;
  packageJson?: PackageJsonConfig;
  /**
   * Stub-file generation configuration. Declares templates and filename
   * conventions for scaffolded entities, value objects, ports, adapters,
   * use-cases, and domain services.
   * See sync-engine-unified-scaffolding plan §Phase 1.
   */
  stubs?: StubsConfig;
  /**
   * Per-framework app-scaffolding configuration. Consumed by the
   * `generateApps` generator in conjunction with top-level `apps[]`.
   * See sync-engine-unified-scaffolding plan §Phase 3.
   */
  apps?: AppsGeneratorConfig;
}

export interface GeneratorConfig {
  version?: string;
  sync?: SyncConfig;
}

// =============================================================================
// File Template Types (shared by stubs / root files / arch invariants / apps)
// =============================================================================

/**
 * Minimal template descriptor used by file-producing generators.
 * `template` is a raw string supporting `{variable}` interpolation handled by
 * `packages/sync/src/template-engine.ts`.
 */
export interface FileTemplate {
  /** Raw template string. Supports `{variable}` interpolation. */
  template?: string;
}

// =============================================================================
// Stub Generator Types (Phase 1)
// =============================================================================

/**
 * Raw template bodies for each stub element type. Each template is
 * interpolated with `{name}` (and potentially other scope variables) at
 * generation time.
 *
 * Declared once globally at `generator.sync.stubs.templates`; per-context
 * overrides of *templates* are intentionally not supported (only naming).
 */
export interface StubTemplates {
  inPort?: string;
  outPort?: string;
  adapter?: string;
  useCase?: string;
  entity?: string;
  valueObject?: string;
  domainService?: string;
}

/**
 * Filename / path conventions for each stub element type. Each entry is a
 * template string interpolated with `{name}` (e.g. `"{name}.adapter.ts"`).
 *
 * May be overridden per bounded context via
 * `bounded_contexts[<name>].generator.stubs.naming`.
 */
export interface StubNaming {
  inPort?: string;
  outPort?: string;
  adapter?: string;
  useCase?: string;
  entity?: string;
  valueObject?: string;
  domainService?: string;
}

/**
 * Top-level stub configuration under `generator.sync.stubs`.
 * The stub generator never overwrites an existing file — any pre-existing
 * stub is reported as `skipped`.
 */
export interface StubsConfig {
  /** Global on/off switch. Defaults to true when the section is present. */
  enabled?: boolean;
  templates?: StubTemplates;
  naming?: StubNaming;
}

// =============================================================================
// Root Files & Architecture Invariants Types (Phase 2)
// =============================================================================

/**
 * Template overrides for monorepo-root files emitted by `generateRootFiles`.
 *
 * `tsConfig` here is an optional root-level override of
 * `workspaceDefaults.tsConfig` for `tsconfig.base.json` specifically — it
 * reuses the same {@link FileTemplate} shape rather than the structured
 * {@link TsConfigTemplate} so authors can supply a raw JSON blob when the
 * structured form is too restrictive.
 */
export interface RootFilesConfig {
  packageJson?: FileTemplate;
  /**
   * Optional override of `workspaceDefaults.tsConfig` for the root-level
   * `tsconfig.base.json` file.
   */
  tsConfig?: FileTemplate;
  turbo?: FileTemplate;
}

/**
 * Template overrides for the `.architecture/**` content written into
 * generated monorepos by `generateArchitectureFiles`.
 *
 * Note: the target monorepo's `.architecture/manifest.yaml` itself is always
 * protected and never overwritten by the engine (see plan §Phase 2).
 */
export interface ArchInvariantsConfig {
  layerRules?: FileTemplate;
  linterConfig?: FileTemplate;
  generatorConfig?: FileTemplate;
}

// =============================================================================
// Apps Generator Types (Phase 3)
// =============================================================================

/**
 * Entry-point file emitted for an app (e.g. `src/app/page.tsx` for Next.js,
 * `src/index.ts` for Fastify / plain-ts).
 */
export interface AppEntryPoint {
  /** Repo-relative path inside the app directory, e.g. `"src/app/page.tsx"`. */
  path: string;
  /** Interpolated template body. Supports `{variable}` interpolation. */
  template?: string;
}

/**
 * Per-framework template set. Reuses {@link TsConfigTemplate} for `tsConfig`
 * so framework tsconfig overrides share the structured shape used elsewhere.
 */
export interface AppFrameworkConfig {
  packageJson?: FileTemplate;
  tsConfig?: TsConfigTemplate;
  entryPoint?: AppEntryPoint;
}

/**
 * Top-level apps-generator configuration under `generator.sync.apps`.
 * Keyed by {@link AppFramework} so the generator can look up templates
 * for each entry in the top-level `apps[]` array.
 */
export interface AppsGeneratorConfig {
  frameworks?: Partial<Record<AppFramework, AppFrameworkConfig>>;
}

// =============================================================================
// ESLint Generator Types (Phase 4)
// =============================================================================

/**
 * Template-shaped eslint config consumed by the `generateEslintConfig`
 * generator (see plan §Phase 4).
 *
 * Intentionally distinct from the legacy {@link ESLintConfig} (`extends` /
 * `rules` structured form) used at `monorepo.eslint`. This form carries a
 * raw `template` body, allowing manifest authors to declare the full
 * `eslint.config.js` contents. A structured override may be added later;
 * for now this is an alias over {@link FileTemplate}.
 */
export type EslintConfig = FileTemplate;

// =============================================================================
// Main Manifest Type
// =============================================================================

export type ArchitectureType =
  | "modular-monolith"
  | "microservices"
  | "monolith";

export interface Manifest {
  // System metadata
  system?: string;
  scope?: string;
  architecture?: ArchitectureType;

  // Monorepo configuration
  monorepo?: MonorepoConfig;

  // Generator configuration
  generator?: GeneratorConfig;

  // Workspace defaults (legacy location — also available under monorepo.workspaceDefaults)
  workspaceDefaults?: WorkspaceDefaults;

  // Bounded contexts (packages)
  bounded_contexts?: BoundedContext[];

  // Applications (apps/)
  apps?: App[];

  // Allow additional properties for forward compatibility
  [key: string]: unknown;
}

// =============================================================================
// Generator Config Types (from generator.config.yaml)
// =============================================================================

export type InvariantPriority = "critical" | "high" | "medium" | "low";
export type FailureBehavior =
  | "abort-and-cleanup"
  | "abort"
  | "warn-and-continue";

export interface Invariant {
  name: string;
  description?: string;
  priority: InvariantPriority;
  enforcement?: "bootstrap" | "generation-time" | "runtime";
  failure: FailureBehavior;
}

export interface OwnershipRegistry {
  ports: Record<string, string>;
}

export interface GeneratorGlobalConfig {
  version?: string;
  description?: string;
  invariants?: Invariant[];
  "bootstrap-sequence"?: string[];
  "failure-behavior"?: Record<InvariantPriority, FailureBehavior>;
  "ownership-registry"?: OwnershipRegistry;
}

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Extract all port names from a bounded context
 */
export function extractPorts(context: BoundedContext): {
  inPorts: string[];
  outPorts: string[];
} {
  const inPorts: string[] = [];
  const outPorts: string[] = [];

  // Domain layer ports (rare but possible for driver contexts)
  if (context.layers?.domain?.ports) {
    inPorts.push(...(context.layers.domain.ports.in ?? []));
    outPorts.push(...(context.layers.domain.ports.out ?? []));
  }

  // Application layer ports (most common)
  if (context.layers?.application?.ports) {
    inPorts.push(...(context.layers.application.ports.in ?? []));
    outPorts.push(...(context.layers.application.ports.out ?? []));
  }

  return { inPorts, outPorts };
}

/**
 * Extract all dependencies for a bounded context
 */
export function extractDependencies(context: BoundedContext): string[] {
  return context.depends_on ?? [];
}

/**
 * Check if a bounded context is a shared kernel
 */
export function isSharedKernel(context: BoundedContext): boolean {
  return context.type === "shared-kernel";
}

/**
 * Check if a bounded context is a driver
 */
export function isDriver(context: BoundedContext): boolean {
  return context.type === "driver";
}

/**
 * Expand a bounded context's `depends_on` list into workspace dependency entries.
 * Used by package-json and tsconfig generators to derive cross-package linkage
 * from the manifest's depends_on declarations.
 *
 * @param context - The bounded context whose depends_on should be expanded
 * @returns Map of @hexagen/<name> → "workspace:*" entries
 */
export function expandDependsOn(
  context: BoundedContext,
): Record<string, string> {
  return Object.fromEntries(
    (context.depends_on ?? []).map((name) => [
      `@hexagen/${name}`,
      "workspace:*",
    ]),
  );
}
