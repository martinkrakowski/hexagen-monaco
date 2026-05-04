export interface StubTemplates {
  inPort?: string;
  outPort?: string;
  adapter?: string;
  useCase?: string;
  entity?: string;
  valueObject?: string;
  domainService?: string;
}

export interface StubNaming {
  inPort?: string;
  outPort?: string;
  adapter?: string;
  useCase?: string;
  entity?: string;
  valueObject?: string;
  domainService?: string;
}

export interface StubsConfig {
  enabled?: boolean;
  templates?: StubTemplates;
  naming?: StubNaming;
}

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
  stubs?: StubsConfig;
  apps?: import("./apps.js").AppsGeneratorConfig;
}

export interface GeneratorConfig {
  version?: string;
  sync?: SyncConfig;
}
