import { z } from "zod";

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
