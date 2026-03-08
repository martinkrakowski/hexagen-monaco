export interface Manifest {
  bounded_contexts?: Array<{ name: string }>;
  generator?: {
    sync?: {
      layers?: Record<string, unknown>; // ← required for ensureDirectories()
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
