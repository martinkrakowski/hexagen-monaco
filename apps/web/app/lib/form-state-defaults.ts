import { projectConfigSchema } from "@hexagen/project-configuration";

/**
 * Canonical all-defaults `formState`, parsed once from the schema itself (every
 * top-level field of `projectConfigSchema` is `.default(...)`). Kept internal +
 * never spread directly: callers use `withFormStateDefaults`, which hands back a
 * fresh deep copy so no two results — or the cache — ever share a mutable nested
 * reference (Zod reuses captured `.default([])`/`.default({})` literals).
 */
const DEFAULT_FORM_STATE = projectConfigSchema.parse({}) as Record<
  string,
  unknown
>;

/**
 * Shallow-pad a (possibly legacy / partial / non-object) `formState` with the
 * schema's canonical top-level defaults — fills missing primitives like
 * `addOnsAnswers` (→ `{}`) without touching present, possibly-drifted nested
 * data. Shallow by design: deep-merging drifted nested objects would mask the
 * very drift we want to preserve. A non-object input yields the canonical
 * defaults.
 *
 * Single source of truth shared by the IDB load perimeter and the export
 * boundary, so they can't drift from the schema or from each other.
 */
export function withFormStateDefaults(raw: unknown): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return { ...structuredClone(DEFAULT_FORM_STATE), ...base };
}
