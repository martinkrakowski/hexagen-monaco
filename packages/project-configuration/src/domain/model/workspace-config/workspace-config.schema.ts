import { z } from "zod";

export const WorkspaceConfigSchema = z.object({
  monorepo: z.record(z.unknown()).optional(),
  generator: z.record(z.unknown()).optional(),
  workspaceDefaults: z.record(z.unknown()).optional(),
  tsConfigRoot: z.record(z.unknown()).optional(),
  eslint: z.record(z.unknown()).optional(),
  rootFiles: z.record(z.unknown()).optional(),
  generatorConfig: z.record(z.unknown()).optional(),
  turboConfig: z.record(z.unknown()).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
