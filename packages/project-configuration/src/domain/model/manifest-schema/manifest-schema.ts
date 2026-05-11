import { z } from "zod";

export const BoundedContextTypeSchema = z.enum([
  "core",
  "supporting",
  "generic",
  "shared-kernel",
  "driver",
]);

export const PlaneTypeSchema = z.enum([
  "projection",
  "probabilistic",
  "infrastructure",
  "shared-kernel",
  "core",
  "supporting",
]);

export const StatusTypeSchema = z.enum([
  "active",
  "frozen",
  "deprecated",
  "experimental",
]);

export const RelationshipPatternSchema = z.enum([
  "U/D",
  "ACL",
  "SK",
  "P",
  "OHS",
]);

export const RelationshipRoleSchema = z.enum([
  "upstream",
  "downstream",
  "peer",
]);

export const RelationshipSchema = z.object({
  context: z.string(),
  pattern: RelationshipPatternSchema,
  role: RelationshipRoleSchema.optional(),
  acl: z
    .object({
      adapter: z.string(),
      location: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  notes: z.string().optional(),
});

export const PortDefinitionSchema = z.object({
  name: z.string(),
  owner: z.string().optional(),
});

export const LegacyOrNewPortSchema = z.union([
  z.string(),
  PortDefinitionSchema,
]);

export const LayerTypeSchema = z.enum([
  "domain",
  "application",
  "infrastructure",
]);

export const BoundedContextSchema = z.object({
  name: z.string(),
  type: BoundedContextTypeSchema,
  plane: PlaneTypeSchema.optional(),
  status: StatusTypeSchema.optional(),
  description: z.string(),
  relationships: z.array(RelationshipSchema).optional(),
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
            in: z.array(LegacyOrNewPortSchema).optional(),
            out: z.array(LegacyOrNewPortSchema).optional(),
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
  generator: z.record(z.unknown()).optional(),
});

export const IndexManifestSchema = z.object({
  version: z.string().optional(),
  system: z.string().optional(),
  scope: z.string().optional(),
  architecture: z.string().optional(),
  planes: z.record(z.array(z.string())).optional(),
  bounded_contexts: z
    .array(
      z.object({
        name: z.string(),
        type: BoundedContextTypeSchema,
        plane: PlaneTypeSchema.optional(),
        status: StatusTypeSchema.optional(),
        file: z.string(),
        frozen_since: z.string().optional(),
      }),
    )
    .optional(),
  apps: z
    .array(
      z.object({
        name: z.string(),
        file: z.string().optional(),
      }),
    )
    .optional(),
  invariants: z.record(z.string()).optional(),
  governance: z.record(z.string()).optional(),
  agent_instructions: z.record(z.unknown()).optional(),
  relationship_patterns: z
    .record(
      z.object({
        description: z.string(),
        acl_required: z.union([z.boolean(), z.literal("optional")]).optional(),
        linter: z.string().optional(),
      }),
    )
    .optional(),
  legacy_config: z.string().optional(),
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
export type PortDefinition = z.infer<typeof PortDefinitionSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type IndexManifest = z.infer<typeof IndexManifestSchema>;
export type PlaneType = z.infer<typeof PlaneTypeSchema>;
