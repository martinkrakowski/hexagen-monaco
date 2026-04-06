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

export const GraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: BoundedContextTypeSchema,
  status: z.enum(["active", "deprecated", "planned"]).default("active"),
});

export const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationship: z.enum(["depends_on", "implements", "uses"]),
  isValid: z.boolean(),
  violationReason: z.string().optional(),
});

export const ArchitectureGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;

export const BoundaryViolationSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["error", "warning"]),
  file: z.string(),
  message: z.string(),
  snippet: z.string().optional(),
});

export const DependencyEventSchema = z.object({
  source: z.string(),
  target: z.string(),
  relationship: z.enum(["depends_on", "implements", "uses"]),
});

export const LinterReportSchema = z.object({
  timestamp: z.string().datetime(),
  isCompliant: z.boolean(),
  violations: z.array(BoundaryViolationSchema),
  scannedFilesCount: z.number(),
});
export type LinterReport = z.infer<typeof LinterReportSchema>;

export const ArchitecturalEventSchema = z.object({
  eventId: z.string().uuid(),
  timestamp: z.string().datetime(),
  type: z.enum(["BoundaryViolated", "DependencyAdded", "ModuleScaffolded"]),
  payload: z.record(z.any()),
});
