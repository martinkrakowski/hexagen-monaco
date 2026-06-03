import { z } from "zod";
import { boundedContextTypeSchema } from "@hexagen/shared";

// 5 = conservative default cap for 3B-model reliability; overridable via the
// wizard's advanced options (set in d302592a, made configurable in e889a243).
export const MAX_BOUNDED_CONTEXTS_DRAFT = 5;
export const DEFAULT_MAX_BOUNDED_CONTEXTS = MAX_BOUNDED_CONTEXTS_DRAFT;

export const GENERIC_CONTEXT_NAMES = [
  "core",
  "main",
  "service",
  "module",
  "app",
  "domain",
  "default",
] as const;

export const ManifestDraftPortSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const ManifestDraftAdapterSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    implements: z.string().min(1),
  })
  .strict();

export const ManifestDraftContextMappingSchema = z
  .object({
    upstream: z.string().min(1),
    downstream: z.string().min(1),
    pattern: z.string().optional(),
    mechanism: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const ManifestDraftContextSchema = z
  .object({
    name: z.string().min(1),
    type: boundedContextTypeSchema,
    description: z.string().min(1),
    ports: z.object({
      in: z.array(ManifestDraftPortSchema),
      out: z.array(ManifestDraftPortSchema),
    }),
    adapters: z.array(ManifestDraftAdapterSchema),
    dependsOn: z.array(z.string()).optional(),
  })
  .strict();

export const ManifestTopologyDraftContextSchema = z
  .object({
    name: z.string().min(1),
    type: boundedContextTypeSchema,
    description: z.string().min(1),
    ports: z.object({
      in: z.array(ManifestDraftPortSchema),
      out: z.array(ManifestDraftPortSchema),
    }),
    dependsOn: z.array(z.string()).optional(),
  })
  .strict();

export function createManifestDraftSchema(
  max: number = MAX_BOUNDED_CONTEXTS_DRAFT,
) {
  return z.object({
    workspace: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
    }),
    boundedContexts: z.array(ManifestDraftContextSchema).min(1).max(max),
    contextMappings: z.array(ManifestDraftContextMappingSchema).optional(),
    apps: z.array(z.record(z.unknown())).optional(),
  });
}

export const ManifestDraftSchema = createManifestDraftSchema();

export function createManifestTopologyDraftSchema(
  max: number = MAX_BOUNDED_CONTEXTS_DRAFT,
) {
  return z.object({
    workspace: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
    }),
    boundedContexts: z
      .array(ManifestTopologyDraftContextSchema)
      .min(1)
      .max(max),
  });
}

export const ManifestTopologyDraftSchema = createManifestTopologyDraftSchema();

export function createContextListSchema(
  max: number = MAX_BOUNDED_CONTEXTS_DRAFT,
) {
  return z
    .array(
      z.object({
        name: z.string().min(1),
        type: boundedContextTypeSchema,
        description: z.string().min(1),
      }),
    )
    .min(1)
    .max(max);
}

export const ContextListSchema = createContextListSchema();

export const PortsListEntrySchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  description: z.string().min(1),
});

export const PortsListSchema = z.object({
  in: z.array(PortsListEntrySchema),
  out: z.array(PortsListEntrySchema),
});
