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
 */
const DEFAULT_FORM_STATE = projectConfigSchema.parse({});

/**
 * Normalize the raw IDB value into `SavedProject[]` at the load perimeter, so
 * the React tree + downstream use cases never see missing keys — notably
 * `addOnsAnswers`, which the schema defaults to `{}`.
 *
 * Per record, by `formState` shape:
 * - **valid** → strict-parsed (defaults filled).
 * - **present but schema-invalid** (e.g. a nested enum tightened/renamed since
 *   it was saved — this repo has had such drift) → **preserved** via a shallow
 *   default-fill (defaults as base, raw spread on top) + logged. Never dropped:
 *   the app already renders this "drifted" data today, so dropping it would be a
 *   silent regression disguised as an upgrade.
 * - **not an object** (genuine corruption) → dropped + logged.
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
    const rawFormState = record.formState;
    const id = typeof record.id === "string" ? record.id : "(no id)";

    // True garbage: formState isn't even an object.
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
        formState: parsed.data,
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
      formState: { ...DEFAULT_FORM_STATE, ...rawFormState },
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
