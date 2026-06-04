import { get, set } from "idb-keyval";
import { projectConfigSchema } from "@hexagen/project-configuration";
import type {
  SavedProject,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
  LoggerPort,
} from "@hexagen/shared";

const SAVED_PROJECTS_KEY = "hexagen:saved-projects";

/**
 * Canonical all-defaults `formState`, derived from the schema itself — every
 * top-level field of `projectConfigSchema` is `.default(...)`, so parsing `{}`
 * yields them. Used as the merge base for records that fail strict validation.
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
 * Fill missing top-level defaults onto a drifted formState while preserving
 * every present (incl. drifted) field. `structuredClone`s the defaults per call
 * so no two records share the module-level default's nested `{}`/`[]` references
 * (a later in-place mutation would otherwise poison sibling records).
 *
 * `addOnsAnswers` is the one field we sanitize rather than preserve: it has a
 * strict downstream contract (`readAddOnAnswers` → route 400) when present-but-
 * malformed, so a preserved record would fail to generate/export. A malformed
 * value carries no renderable user intent, so we reset it to `{}`.
 */
function preserveWithDefaults(
  rawFormState: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...structuredClone(DEFAULT_FORM_STATE), ...rawFormState };
  const addOns = merged.addOnsAnswers;
  if (typeof addOns !== "object" || addOns === null || Array.isArray(addOns)) {
    merged.addOnsAnswers = {};
  }
  return merged;
}

/**
 * Normalize the raw IDB value into `SavedProject[]` at the load perimeter, so
 * the React tree + downstream use cases never see missing keys — notably
 * `addOnsAnswers`, which the schema defaults to `{}`.
 *
 * Per record:
 * - **no string `id`** → dropped + logged. A record with no usable id can't be
 *   keyed/opened/deleted — unusable, not recoverable.
 * - **non-string `name`** → defaulted to `"Untitled"` (not dropped). `name` is
 *   display-only (sorted via `.toLowerCase()`), so a valid project with a bad
 *   name is preserved — and the UI no longer crashes on it.
 * - **`formState` not an object** → dropped + logged (genuine corruption).
 * - **valid `formState`** → strict-parsed (defaults filled); unknown/future
 *   top-level keys are re-layered from the raw record so the valid path doesn't
 *   silently drop them (symmetry with the preserve path — never drop).
 * - **present but schema-invalid `formState`** (e.g. a nested enum tightened/
 *   renamed since it was saved — this repo has had such drift) → **preserved**
 *   via `preserveWithDefaults` + logged. Never dropped: the app already renders
 *   this "drifted" data today, so dropping it would be a silent regression.
 *
 * One bad record never fails the whole load (per-record isolation) — that would
 * hide every saved project.
 */
export function normalizeLoadedProjects(
  raw: unknown,
  logger?: LoggerPort,
): SavedProject[] {
  if (!Array.isArray(raw)) return [];

  const out: SavedProject[] = [];
  for (const entry of raw as unknown[]) {
    const record: Record<string, unknown> =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
    // No usable string id → the record can't be keyed/opened/deleted; drop it.
    if (typeof record.id !== "string") {
      logger?.warn("[saved-projects] dropping a record — missing/invalid id");
      continue;
    }
    const id = record.id;
    // Display-only (sorted via `.toLowerCase()`); default rather than drop so a
    // valid project survives a bad name and the project list doesn't crash.
    const name = typeof record.name === "string" ? record.name : "Untitled";

    const rawFormState = record.formState;

    // True garbage: formState isn't even an object. This drop does NOT desync the
    // localStorage→IDB migration's read-back count: that step admits only
    // string-id rows and copies formState via `{ ...formState }` (null/array →
    // plain object) before writing, so a migrated record is always an object here
    // and survives. (Don't "fix" it by skipping such rows in the migration — that
    // would destroy their id/name/manifestYaml once localStorage is cleared.)
    if (
      typeof rawFormState !== "object" ||
      rawFormState === null ||
      Array.isArray(rawFormState)
    ) {
      logger?.warn(
        `[saved-projects] dropping record ${id} — formState is not an object`,
      );
      continue;
    }

    const parsed = projectConfigSchema.safeParse(rawFormState);
    if (parsed.success) {
      out.push({
        ...(record as unknown as SavedProject),
        name,
        // Re-layer raw under parsed.data: projectConfigSchema strips unknown
        // top-level keys, and Path 4 must not silently drop them (symmetry with
        // the preserve path). parsed.data wins for every known/defaulted key.
        formState: {
          ...(rawFormState as Record<string, unknown>),
          ...parsed.data,
        } as SavedProject["formState"],
      });
      continue;
    }

    // Preserve-with-defaults: keep every present field (incl. drifted ones the
    // app still renders) and fill only missing top-level defaults. Log the
    // failing paths so we can tell known enum drift from a new corruption vector.
    const issues =
      parsed.error.issues.map((i) => i.path.join(".")).join(", ") || "(root)";
    logger?.warn(
      `[saved-projects] formState failed schema validation for ${id}; preserved with defaults. issues: ${issues}`,
    );
    out.push({
      ...(record as unknown as SavedProject),
      name,
      formState: preserveWithDefaults(
        rawFormState as Record<string, unknown>,
      ) as SavedProject["formState"],
    });
  }
  return out;
}

export class IDBSavedProjectsAdapter implements SavedProjectsPersistencePort {
  constructor(private readonly logger?: LoggerPort) {}

  async loadProjects(): Promise<Result<SavedProject[], PersistenceError>> {
    try {
      const data = await get(SAVED_PROJECTS_KEY);
      return {
        success: true,
        value: normalizeLoadedProjects(data, this.logger),
      };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed",
          message: "Failed to load saved projects from IDB",
          cause: e,
        },
      };
    }
  }

  async saveProjects(
    projects: SavedProject[],
  ): Promise<Result<void, PersistenceError>> {
    try {
      await set(SAVED_PROJECTS_KEY, projects);
      return { success: true, value: undefined };
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        return {
          success: false,
          error: {
            kind: "StorageQuotaExceeded",
            message: "IDB storage quota exceeded",
          },
        };
      }
      return {
        success: false,
        error: {
          kind: "SerializationFailed",
          message: "Failed to save projects to IDB",
          cause: e,
        },
      };
    }
  }
}
