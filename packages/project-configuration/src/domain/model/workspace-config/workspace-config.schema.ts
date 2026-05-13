import { z } from "zod";

const MonorepoConfigSchema = z.object({
  packageManager: z.string().optional(),
  workspaces: z.array(z.string()).optional(),
  rootFiles: z.record(z.unknown()).optional(),
  archInvariants: z.record(z.unknown()).optional(),
});

const GeneratorSyncSchema = z.object({
  layers: z.record(z.unknown()).optional(),
  packageJson: z.record(z.unknown()).optional(),
  stubs: z.record(z.unknown()).optional(),
  apps: z.record(z.unknown()).optional(),
});

const GeneratorConfigSchema = z.object({
  version: z.string().optional(),
  sync: GeneratorSyncSchema.optional(),
});

export const WorkspaceConfigSchema = z.object({
  monorepo: MonorepoConfigSchema.optional(),
  generator: GeneratorConfigSchema.optional(),
  workspaceDefaults: z.record(z.unknown()).optional(),
  tsConfigRoot: z.record(z.unknown()).optional(),
  eslint: z.record(z.unknown()).optional(),
  rootFiles: z.record(z.unknown()).optional(),
  generatorConfig: z.record(z.unknown()).optional(),
  turboConfig: z.record(z.unknown()).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
