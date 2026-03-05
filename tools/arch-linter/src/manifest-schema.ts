import { z } from 'zod';

export const ArchitectureManifestSchema = z.object({
  system: z.string().min(1, 'System name is required'),
  scope: z.string().min(1, 'Scope is required'),
  architecture: z.string().optional(),
  monorepo: z.object({
    workspaces: z.array(z.string()),
  }),
  tsConfigRootFile: z.string().optional(),
  generator: z
    .object({
      version: z.string().optional(),
      sync: z
        .object({
          idempotent: z.boolean().optional(),
          createOnlyIfMissing: z.boolean().optional(),
          layers: z.record(z.string()).optional(),
          barrels: z
            .object({
              autoGenerate: z.boolean().optional(),
              perLayer: z.boolean().optional(),
              reexportStyle: z.enum(['named', 'star']).optional(),
              includeGlobs: z.array(z.string()).optional(),
            })
            .optional(),
          packageJson: z
            .object({
              private: z.boolean().optional(),
              version: z.string().optional(),
              license: z.string().optional(),
              scripts: z.record(z.string()).optional(),
              baseDependencies: z.record(z.string()).optional(),
              baseDevDependencies: z.record(z.string()).optional(),
            })
            .optional(),
          tsconfig: z
            .object({
              compilerOptions: z.record(z.unknown()).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  workspaceDefaults: z
    .object({
      tsConfig: z
        .object({
          extends: z.string().optional(),
          compilerOptions: z.record(z.unknown()).optional(),
        })
        .optional(),
      scripts: z.record(z.string()).optional(),
    })
    .optional(),
  modules: z.array(
    z.object({
      name: z.string().min(1, 'Module name is required'),
      description: z.string().optional(),
      entities: z.array(z.string()).optional(),
      value_objects: z.array(z.string()).optional(),
      use_cases: z.array(z.string()).optional(),
      ports: z
        .object({
          out: z.array(z.string()).optional(),
        })
        .optional(),
      infrastructure: z.record(z.unknown()).optional(),
      generator: z
        .object({
          dependencies: z.record(z.string()).optional(),
          devDependencies: z.record(z.string()).optional(),
        })
        .optional(),
    })
  ),
  apps: z
    .array(
      z.object({
        name: z.string(),
        driver: z.string(),
        depends_on: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export type ArchitectureManifest = z.infer<typeof ArchitectureManifestSchema>;
