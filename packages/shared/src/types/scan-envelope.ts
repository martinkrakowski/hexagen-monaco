import { z } from "zod";

/**
 * The scan envelope contract between `hexagen scan` (packages/sync, producer)
 * and the web adapter (apps/web, consumer).
 *
 * Two guarantees, both enforced below rather than merely described:
 * - An unrecognized `schemaVersion` major is REFUSED, so a future producer
 *   cannot be half-parsed by an older consumer.
 * - Unknown fields are PRESERVED but not validated (`.passthrough()`), so an
 *   additive producer change does not break an older consumer.
 *
 * @see docs/planning/2026-08-20-brownfield-ui-feature-plan.md §4 BF-0.0
 */

/**
 * The current schema version string that producers emit.
 *
 * Declared before the schema because the schema's major check reads it -- an
 * earlier revision exported this constant but never referenced it, which left
 * the "refuse an unrecognized major" guarantee documented but unimplemented.
 */
export const CURRENT_SCHEMA_VERSION = "1.0.0";

/** Major component of a semver-ish string: the digits before the first `.`. */
function majorOf(version: string): string | null {
  const match = /^(\d+)(?:\.|$)/.exec(version);
  return match ? match[1] : null;
}

const SUPPORTED_MAJOR = majorOf(CURRENT_SCHEMA_VERSION);

export const ScanEnvelope = z
  .object({
    schemaVersion: z
      .string({ required_error: "schemaVersion is required" })
      .refine((v) => majorOf(v) !== null, {
        message: "schemaVersion must start with a numeric major, e.g. '1.0.0'",
      })
      .refine((v) => majorOf(v) === SUPPORTED_MAJOR, {
        message: `Unsupported schemaVersion major; this consumer understands ${SUPPORTED_MAJOR}.x`,
      }),
    // `layout` is the raw TEXT of the producer's .architecture/layout.yaml, not
    // a structured object: packages/sync reads that file, and the web adapter
    // guards on `typeof rec.layout === "string"` before clipping it to an
    // excerpt. A looser z.unknown() here let a structured fixture through that
    // the real consumer would silently ignore.
    layout: z.string().nullable().optional(),
    filesScanned: z.number().int().min(0).optional(),
    reportMarkdown: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .passthrough();

export type ScanEnvelope = z.infer<typeof ScanEnvelope>;

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
