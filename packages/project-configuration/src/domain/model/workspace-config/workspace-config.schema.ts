import { z } from "zod";

/**
 * Shape of `.architecture/workspace.config.yaml` — the side-car that
 * `hexagen manifest split` moves the root manifest's `monorepo` and `generator`
 * blocks into, and that `mergeSplitManifest` reads back.
 *
 * EVERY object here is `.passthrough()`, deliberately. The declared keys are a
 * documentation and typing aid, not an allowlist: the blocks land in
 * `Manifest.monorepo` / `Manifest.generator`, both of which are
 * `z.record(z.unknown())`, and their real consumers reach far past what is
 * named below — `monorepo.turboConfig` (root-files), `monorepo.workspaceDefaults`
 * (eslint, tsconfig), `generator.sync.protectedRootFiles`. A stripping
 * `z.object` here would re-create, one level down, exactly the silent data loss
 * this schema exists to end.
 */
const MonorepoConfigSchema = z
  .object({
    packageManager: z.string().optional(),
    workspaces: z.array(z.string()).optional(),
    rootFiles: z.record(z.unknown()).optional(),
    archInvariants: z.record(z.unknown()).optional(),
  })
  .passthrough();

const GeneratorSyncSchema = z
  .object({
    layers: z.record(z.unknown()).optional(),
    packageJson: z.record(z.unknown()).optional(),
    stubs: z.record(z.unknown()).optional(),
    apps: z.record(z.unknown()).optional(),
  })
  .passthrough();

const GeneratorConfigSchema = z
  .object({
    version: z.string().optional(),
    sync: GeneratorSyncSchema.optional(),
  })
  .passthrough();

export const WorkspaceConfigSchema = z
  .object({
    monorepo: MonorepoConfigSchema.optional(),
    generator: GeneratorConfigSchema.optional(),
    workspaceDefaults: z.record(z.unknown()).optional(),
    tsConfigRoot: z.record(z.unknown()).optional(),
    eslint: z.record(z.unknown()).optional(),
    rootFiles: z.record(z.unknown()).optional(),
    generatorConfig: z.record(z.unknown()).optional(),
    turboConfig: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
