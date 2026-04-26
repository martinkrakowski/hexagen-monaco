import { z } from "zod";

export const BoundedContextTypeSchema = z.enum([
  "core",
  "supporting",
  "driver",
  "shared-kernel",
]);

export const LayerTypeSchema = z.enum([
  "domain",
  "application",
  "infrastructure",
]);

export const BoundedContextSchema = z.object({
  name: z.string(),
  type: BoundedContextTypeSchema,
  description: z.string(),
  layers: z.object({
    domain: z
      .object({
        entities: z.array(z.string()).optional(),
        value_objects: z.array(z.string()).optional(),
      })
      .optional(),
    application: z
      .object({
        use_cases: z.array(z.string()).optional(),
        ports: z
          .object({
            in: z.array(z.string()).optional(),
            out: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
    infrastructure: z
      .object({
        adapters: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  depends_on: z.array(z.string()).optional(),
  wiring: z.array(z.string()).optional(),
});

export const ManifestSchema = z
  .object({
    system: z.string().optional(),
    scope: z.string().optional(),
    architecture: z.string().optional(),
    bounded_contexts: z.array(BoundedContextSchema),
    apps: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type Manifest = z.infer<typeof ManifestSchema>;
