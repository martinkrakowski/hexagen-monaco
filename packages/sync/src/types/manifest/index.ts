export type {
  DomainLayer,
  PortDefinition,
  LegacyOrNewPort,
  ApplicationPorts,
  ApplicationLayer,
  InfrastructureLayer,
  BoundedContextLayers,
} from "./layers.js";

export type {
  BoundedContextType,
  RelationshipPattern,
  RelationshipRole,
  AclDefinition,
  Relationship,
  BoundedContext,
  BoundedContextGenerator,
  BoundedContextWiring,
} from "./bounded-context.js";

export type {
  AppDriver,
  AppFramework,
  App,
  AppEntryPoint,
  AppFrameworkConfig,
  AppsGeneratorConfig,
} from "./apps.js";

export type {
  ESLintConfig,
  TSConfigCompilerOptions,
  TSConfigRoot,
  TsConfigTemplate,
  FileTemplate,
  EslintConfig,
  WorkspaceDefaults,
  TurboPipeline,
  TurboConfig,
  MonorepoRoot,
  RootFilesConfig,
  ArchInvariantsConfig,
  MonorepoConfig,
} from "./monorepo.js";

export type {
  StubTemplates,
  StubNaming,
  StubsConfig,
  LayerConfig,
  PackageJsonConfig,
  SyncConfig,
  GeneratorConfig,
} from "./generator.js";

export type {
  ArchitectureType,
  Manifest,
  InvariantPriority,
  FailureBehavior,
  Invariant,
  OwnershipRegistry,
  GeneratorGlobalConfig,
  PlaneType,
  IndexBoundedContextEntry,
  IndexAppEntry,
  IndexManifest,
} from "./manifest.js";

export {
  portName,
  extractPorts,
  extractDependencies,
  isSharedKernel,
  isDriver,
  expandDependsOn,
} from "./helpers.js";
