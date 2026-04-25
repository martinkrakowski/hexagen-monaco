import { z } from "zod";
import { BoundedContextTypeSchema } from "@hexagen/project-configuration";

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
