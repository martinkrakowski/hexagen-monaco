export interface LayerConfig {
  folder: string;
  subfolders?: string[];
}

export interface Manifest {
  bounded_contexts?: Array<{
    name: string;
    packageJson?: Record<string, unknown>;
  }>;
  generator?: {
    sync?: {
      layers?: Record<string, LayerConfig>;
      protectedRootFiles?: string[];
      packageJson?: {
        protectedKeys?: string[];
        mergeStrategy?: string;
      };
    };
  };
  workspaceDefaults?: {
    packageJson?: Record<string, unknown>;
  };
  [key: string]: unknown;
}
