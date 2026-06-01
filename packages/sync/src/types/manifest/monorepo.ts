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

export interface TsConfigTemplate {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
  references?: Array<{ path: string }>;
}

export interface FileTemplate {
  template?: string;
}

export type EslintConfig = FileTemplate;

export interface WorkspaceDefaults {
  tsConfig?: TsConfigTemplate;
  packageJson?: Record<string, unknown>;
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

export interface RootFilesConfig {
  packageJson?: FileTemplate;
  tsConfig?: FileTemplate;
  turbo?: FileTemplate;
  gitignore?: FileTemplate;
  yarnrc?: FileTemplate;
  setup?: FileTemplate;
}

export interface ArchInvariantsConfig {
  layerRules?: FileTemplate;
  linterConfig?: FileTemplate;
  generatorConfig?: FileTemplate;
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
  rootFiles?: RootFilesConfig;
  archInvariants?: ArchInvariantsConfig;
}
