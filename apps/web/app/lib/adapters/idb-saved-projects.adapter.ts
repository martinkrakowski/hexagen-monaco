import { get, set } from "idb-keyval";
import { projectConfigSchema } from "@hexagen/project-configuration";
import { withFormStateDefaults } from "../form-state-defaults";
import type {
  SavedProject,
  ProjectLayer,
  ProjectLayerTurn,
  SavedProjectsPersistencePort,
  PersistenceError,
  Result,
  LoggerPort,
} from "@hexagen/shared";

const SAVED_PROJECTS_KEY = "hexagen:saved-projects";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Salvage `layers` at the load perimeter, using the same policy as the
 * record-level normalize above: preserve payload, default metadata, drop only
 * genuine garbage. A brainstorm turn's `content` is often the user's only copy
 * of that prose (a pasted archive, or a live-session turn generated in-app), so
 * damaged metadata (`author`/`id`/`at`) never deletes it — a turn is dropped
 * only when it isn't an object or its `content` isn't a string. Missing ids are
 * synthesized deterministically (stable across reloads for unchanged data, so
 * React keys don't churn); missing/mistyped `author`, `title`, and timestamps
 * default rather than drop.
 */
export function normalizeLayers(
  raw: unknown,
  projectId: string,
  logger?: LoggerPort,
): ProjectLayer[] {
  // Absent (undefined) or explicit null → no layers, silently. Only a present
  // non-array value is worth warning about.
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    logger?.warn(
      `[saved-projects] layers for ${projectId} is not an array; defaulting to []`,
    );
    return [];
  }

  const layers: ProjectLayer[] = [];
  raw.forEach((rawLayer, layerIndex) => {
    if (!isRecord(rawLayer)) {
      logger?.warn(
        `[saved-projects] dropping a layer on ${projectId} — not an object`,
      );
      return;
    }

    const layerId =
      typeof rawLayer.id === "string" && rawLayer.id
        ? rawLayer.id
        : `${projectId}-layer-${layerIndex}`;
    // Preserve an unknown/future `kind` rather than mislabel it; default only a
    // missing/non-string one to the sole v1 kind.
    const kind =
      typeof rawLayer.kind === "string" && rawLayer.kind
        ? (rawLayer.kind as ProjectLayer["kind"])
        : "brainstorm";
    const title =
      typeof rawLayer.title === "string" && rawLayer.title
        ? rawLayer.title
        : "Untitled session";
    const createdAt = Number.isFinite(rawLayer.createdAt)
      ? (rawLayer.createdAt as number)
      : 0;
    const updatedAt = Number.isFinite(rawLayer.updatedAt)
      ? (rawLayer.updatedAt as number)
      : createdAt;

    const rawTurns = Array.isArray(rawLayer.turns) ? rawLayer.turns : [];
    const turns: ProjectLayerTurn[] = [];
    rawTurns.forEach((rawTurn, turnIndex) => {
      if (!isRecord(rawTurn)) {
        logger?.warn(
          `[saved-projects] dropping a turn on ${layerId} — not an object`,
        );
        return;
      }
      // `content` is the irreplaceable payload — the only drop condition.
      if (typeof rawTurn.content !== "string") {
        logger?.warn(
          `[saved-projects] dropping a turn on ${layerId} — content is not a string`,
        );
        return;
      }
      turns.push({
        id:
          typeof rawTurn.id === "string" && rawTurn.id
            ? rawTurn.id
            : `${layerId}-turn-${turnIndex}`,
        author: typeof rawTurn.author === "string" ? rawTurn.author : "Unknown",
        content: rawTurn.content,
        ...(Number.isFinite(rawTurn.at) ? { at: rawTurn.at as number } : {}),
      });
    });

    layers.push({ id: layerId, kind, title, turns, createdAt, updatedAt });
  });
  return layers;
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
 *   via `withFormStateDefaults` + logged. Never dropped: the app already renders
 *   this "drifted" data today, so dropping it would be a silent regression.
 * - **`layers`** → defaulted to `[]` when absent and salvaged per turn (see
 *   `normalizeLayers`), on BOTH the valid and preserve paths.
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
        layers: normalizeLayers(record.layers, id, logger),
      });
      continue;
    }

    // Preserve-with-defaults: keep every present field (incl. drifted ones the
    // app still renders) and fill only missing top-level defaults via the shared
    // helper (schema defaults + structuredClone isolation + addOnsAnswers
    // sanitization). Log the failing paths so we can tell known enum drift from
    // a new corruption vector.
    const issues =
      parsed.error.issues.map((i) => i.path.join(".")).join(", ") || "(root)";
    logger?.warn(
      `[saved-projects] formState failed schema validation for ${id}; preserved with defaults. issues: ${issues}`,
    );
    out.push({
      ...(record as unknown as SavedProject),
      name,
      formState: withFormStateDefaults(
        rawFormState,
      ) as SavedProject["formState"],
      layers: normalizeLayers(record.layers, id, logger),
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
