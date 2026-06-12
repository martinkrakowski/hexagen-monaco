import { z } from "zod";
import { boundedContextTypeSchema } from "@hexagen/shared";

/**
 * Wraps a Zod enum so validation is case-insensitive. LLM-generated manifests
 * frequently vary the casing of enum values (e.g. `"Core"` instead of `"core"`),
 * which would otherwise fail validation at parse/approval time
 * (`parseManifestToWizardData` → `ManifestSchema.safeParse`). The input string is
 * trimmed and normalized to the enum's canonical casing before validation (the
 * generation-side `coerceContextType` trims too). Most enums are
 * lowercase; pass `"upper"` for enums whose canonical values are uppercase
 * (e.g. `RelationshipPattern`: `"ACL"`, `"OHS"`).
 */
function caseInsensitiveEnum<T extends z.ZodTypeAny>(
  schema: T,
  dir: "lower" | "upper" = "lower",
) {
  return z.preprocess(
    (value) =>
      typeof value === "string"
        ? dir === "lower"
          ? value.trim().toLowerCase()
          : value.trim().toUpperCase()
        : value,
    schema,
  );
}

// Bounded-context type is the one enum shared across packages; source the
// canonical case-insensitive schema from @hexagen/shared so neither the value
// list (notably "driver") nor its normalization can drift between packages.
// Intentionally NOT wrapped in the local caseInsensitiveEnum helper (used by the
// other enums below): normalization for this type is owned by @hexagen/shared.
export const BoundedContextTypeSchema = boundedContextTypeSchema;

/** Canonical plane-name vocabulary. The schema below derives from this single
 * literal so the name list and the validator cannot drift apart. */
export const PLANE_NAMES = [
  "projection",
  "probabilistic",
  "infrastructure",
  "shared-kernel",
  "core",
  "supporting",
] as const;

export const PlaneTypeSchema = caseInsensitiveEnum(z.enum(PLANE_NAMES));

export const StatusTypeSchema = caseInsensitiveEnum(
  z.enum(["active", "frozen", "deprecated", "experimental"]),
);

export const RelationshipPatternSchema = caseInsensitiveEnum(
  z.enum(["U/D", "ACL", "SK", "P", "OHS"]),
  "upper",
);

export const RelationshipRoleSchema = caseInsensitiveEnum(
  z.enum(["upstream", "downstream", "peer"]),
);

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

export const LayerTypeSchema = caseInsensitiveEnum(
  z.enum(["domain", "application", "infrastructure"]),
);

export const BoundedContextSchema = z.object({
  name: z.string(),
  type: BoundedContextTypeSchema.optional(),
  plane: PlaneTypeSchema.optional(),
  status: StatusTypeSchema.optional(),
  description: z.string().optional(),
  relationships: z.array(RelationshipSchema).optional(),
  layers: z
    .object({
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
    })
    .optional(),
  depends_on: z.array(z.string()).optional(),
  wiring: z.array(z.string()).optional(),
  generator: z.record(z.unknown()).optional(),
});

export const AppSchema = z
  .object({
    name: z.string(),
    framework: z.string().optional(),
    version: z.string().optional(),
    driver: z.string().optional(),
    description: z.string().optional(),
    role: z.string().optional(),
    router: z.string().optional(),
    deployment: z.string().optional(),
    auth: z.string().optional(),
    schedule: z.string().optional(),
    ui: z
      .object({
        library: z.string().optional(),
        styling: z.string().optional(),
      })
      .optional(),
    responsibilities: z.array(z.string()).optional(),
    depends_on: z.array(z.string()).optional(),
  })
  // Silently strip unknown properties to tolerate forward-compatible imported manifests
  // and allow graceful degradation when importing specs with extra fields
  .strip();

export const IndexManifestSchema = z
  .object({
    // Toolchain-compatibility stamp (see manifest-schema-version.ts). Note
    // `version` below is a DIFFERENT field — its `"2.0"` string is the
    // index-form discriminator (`isIndexManifest`), not a compatibility gate.
    schemaVersion: z.number().int().positive().optional(),
    version: z.string().optional(),
    description: z.string(),
    system: z.string().optional(),
    scope: z.string().optional(),
    architecture: z.string().optional(),
    planes: z.record(z.array(z.string())).optional(),
    bounded_contexts: z
      .array(
        z.object({
          name: z.string(),
          type: BoundedContextTypeSchema.optional(),
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
          acl_required: z
            .union([z.boolean(), z.literal("optional")])
            .optional(),
          linter: z.string().optional(),
        }),
      )
      .optional(),
    mvk: z.record(z.unknown()).optional(),
    workspace_config: z.string().optional(),
    legacy_config: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const contexts = data.bounded_contexts ?? [];
      return contexts.every((ctx) => {
        if (ctx.plane && ctx.file) {
          return ctx.file.startsWith(`contexts/${ctx.plane}/`);
        }
        return true;
      });
    },
    {
      message: "Context plane does not match file path subdirectory",
      path: ["bounded_contexts"],
    },
  );

/**
 * A cross-context transport edge (Phase 3). The wizard's `deriveCrossContextEdges`
 * emits these into the manifest; the `generateCrossContext` emitter consumes them;
 * and the arch-linter enforces `required_communication` against them (each edge's
 * transport ports must exist). Discriminated on `transport`: event-bus carries the
 * provider's `events`, network the provider's `operations`.
 */
export const CrossContextEdgeSchema = z.object({
  consumer: z.string(),
  provider: z.string(),
  transport: z.enum(["event-bus", "network"]),
  events: z.array(z.string()).optional(),
  operations: z.array(z.string()).optional(),
  integrationPattern: z.enum(["open-host", "acl"]).optional(),
});

export const ManifestSchema = z
  .object({
    // Toolchain-compatibility stamp (positive int; absent = legacy). NOT the
    // freeform `version` string below. Compatibility is asserted against the
    // RAW yaml BEFORE this `.strict()` parse (assertSupportedSchemaVersion in
    // manifest-schema-version.ts) — this entry only keeps strict mode from
    // rejecting stamped manifests as carrying an unknown key.
    schemaVersion: z.number().int().positive().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    system: z.string().optional(),
    scope: z.string().optional(),
    architecture: z.string().optional(),
    // The wizard records the chosen workspace template (e.g. "strict-enterprise")
    // alongside `architecture`; persisted into .architecture/manifest.yaml.
    workspaceTemplate: z.string().optional(),
    planes: z.record(z.array(z.string())).optional(),
    monorepo: z.record(z.unknown()).optional(),
    generator: z.record(z.unknown()).optional(),
    mvk: z.record(z.unknown()).optional(),
    invariants: z.record(z.string()).optional(),
    governance: z.record(z.string()).optional(),
    agent_instructions: z.record(z.unknown()).optional(),
    relationship_patterns: z
      .record(
        z.object({
          description: z.string(),
          acl_required: z
            .union([z.boolean(), z.literal("optional")])
            .optional(),
          linter: z.string().optional(),
        }),
      )
      .optional(),
    bounded_contexts: z.array(BoundedContextSchema),
    apps: z.array(AppSchema).optional(),
    cross_context: z.array(CrossContextEdgeSchema).optional(),
    context_mappings: z
      .array(
        z.object({
          upstream: z.string(),
          downstream: z.string(),
          pattern: z.string().optional(),
          mechanism: z.string().optional(),
          notes: z.string().optional(),
          events: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    workspaceDefaults: z.record(z.unknown()).optional(),
    legacy_config: z.string().optional(),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestBoundedContext = z.infer<typeof BoundedContextSchema>;
export type PortDefinition = z.infer<typeof PortDefinitionSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type IndexManifest = z.infer<typeof IndexManifestSchema>;
export type PlaneType = z.infer<typeof PlaneTypeSchema>;
export type IndexBoundedContextEntry = z.infer<
  typeof IndexManifestSchema
>["bounded_contexts"] extends Array<infer T> | undefined
  ? T
  : never;

export type App = z.infer<typeof AppSchema>;
