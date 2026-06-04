import { projectConfigSchema } from "@hexagen/project-configuration";

/**
 * Canonical all-defaults `formState`, derived once from the schema itself (every
 * top-level field of `projectConfigSchema` is `.default(...)`). Kept internal +
 * never spread directly: callers use `withFormStateDefaults`, which hands back a
 * fresh deep copy so no two results — or the cache — ever share a mutable nested
 * reference (Zod reuses captured `.default([])`/`.default({})` literals).
 *
 * Derived via `safeParse` (not `parse`): if a future schema change makes `{}`
 * un-defaultable, this degrades to a minimal floor instead of throwing at module
 * load and white-screening the whole app.
 */
function deriveDefaultFormState(): Record<string, unknown> {
  const parsed = projectConfigSchema.safeParse({});
  return parsed.success
    ? (parsed.data as Record<string, unknown>)
    : { addOnsAnswers: {} };
}
const DEFAULT_FORM_STATE = deriveDefaultFormState();

/**
 * Shallow-pad a (possibly legacy / partial / non-object) `formState` with the
 * schema's canonical top-level defaults — fills missing primitives like
 * `addOnsAnswers` (→ `{}`) without touching present, possibly-drifted nested
 * data. Shallow by design: deep-merging drifted nested objects would mask the
 * very drift we want to preserve. A non-object input yields the canonical
 * defaults.
 *
 * `addOnsAnswers` is the one field sanitized rather than preserved: it has a
 * strict downstream contract (`readAddOnAnswers` → route 400) when present-but-
 * malformed, so a drifted record carrying e.g. `addOnsAnswers: null` would fail
 * to generate/export. A malformed value carries no renderable intent → reset to `{}`.
 *
 * Single source of truth shared by the IDB load perimeter and the export
 * boundary, so they can't drift from the schema or from each other.
 */
export function withFormStateDefaults(raw: unknown): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const merged = { ...structuredClone(DEFAULT_FORM_STATE), ...base };
  const addOns = merged.addOnsAnswers;
  if (typeof addOns !== "object" || addOns === null || Array.isArray(addOns)) {
    merged.addOnsAnswers = {};
  }
  return merged;
}
