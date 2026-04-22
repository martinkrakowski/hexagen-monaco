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

export interface App {
  name: string;
  driver?: AppDriver;
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
}

export interface GeneratorConfig {
  version?: string;
  sync?: SyncConfig;
}

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
