import { z } from "zod";

/**
 * Schema version for the scan envelope contract between
 * `hexagen scan` (packages/sync) and the web adapter (apps/web).
 *
 * Consumers must:
 * - Refuse an unrecognized `schemaVersion` major (before the first `-` or all digits)
 * - Ignore unknown fields (they are preserved but not validated)
 *
 * @see docs/planning/2026-08-20-brownfield-ui-feature-plan.md §4 BF-0.0
 */
export const ScanEnvelope = z
  .object({
    schemaVersion: z.string({ required_error: "schemaVersion is required" }),
    layout: z.unknown().optional(),
    filesScanned: z.number().int().min(0).optional(),
    reportMarkdown: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();

export type ScanEnvelope = z.infer<typeof ScanEnvelope>;

/**
 * The current schema version string that producers must emit
 * and consumers must accept.
 */
export const CURRENT_SCHEMA_VERSION = "1.0.0";

/**
 * Parse a raw object against the scan envelope schema.
 * Throws if `schemaVersion` is missing.
 * Unknown fields are preserved (passthrough).
 */
export function parseScanEnvelope(raw: unknown): ScanEnvelope {
  return ScanEnvelope.parse(raw);
}

/**
 * Safe-parse variant that returns a Result-like shape
 * instead of throwing.
 */
export function safeParseScanEnvelope(raw: unknown):
  | {
      success: true;
      data: ScanEnvelope;
    }
  | {
      success: false;
      error: z.ZodError;
    } {
  const result = ScanEnvelope.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
