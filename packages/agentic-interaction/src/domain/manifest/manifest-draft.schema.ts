import { z } from "zod";

export const MAX_BOUNDED_CONTEXTS_DRAFT = 10;

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

export const ManifestDraftContextSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(["core", "supporting", "driver", "shared-kernel"]),
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
    type: z.enum(["core", "supporting", "driver", "shared-kernel"]),
    description: z.string().min(1),
    ports: z.object({
      in: z.array(ManifestDraftPortSchema),
      out: z.array(ManifestDraftPortSchema),
    }),
    dependsOn: z.array(z.string()).optional(),
  })
  .strict();

export const ManifestDraftSchema = z.object({
  workspace: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  boundedContexts: z
    .array(ManifestDraftContextSchema)
    .min(1)
    .max(MAX_BOUNDED_CONTEXTS_DRAFT),
});

export const ManifestTopologyDraftSchema = z.object({
  workspace: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  boundedContexts: z
    .array(ManifestTopologyDraftContextSchema)
    .min(1)
    .max(MAX_BOUNDED_CONTEXTS_DRAFT),
});

export const ContextListSchema = z
  .array(
    z.object({
      name: z.string().min(1),
      type: z.enum(["core", "supporting", "driver", "shared-kernel"]),
      description: z.string().min(1),
    }),
  )
  .min(1)
  .max(MAX_BOUNDED_CONTEXTS_DRAFT);

export const PortsListSchema = z.object({
  in: z.array(z.string().min(1)),
  out: z.array(z.string().min(1)),
});
