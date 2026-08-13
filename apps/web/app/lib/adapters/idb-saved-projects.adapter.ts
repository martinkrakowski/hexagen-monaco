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

// ─── Phase-3 live-session field salvage (self-contained block) ──────────────
// Salvage policy matches the rest of this file: an invalid value drops the
// FIELD, never the layer or turn. `link`/`sourceLayerId` salvage lives with
// the other Phase-2 provenance handling inside normalizeLayers, not here.

const LAYER_STATUSES = new Set<NonNullable<ProjectLayer["status"]>>([
  "proposing",
  "critiquing",
  "revising",
  "awaiting-human",
  "converged",
  "finalizing",
  "done",
]);

const TURN_ROLES = new Set<NonNullable<ProjectLayerTurn["role"]>>([
  "proposer",
  "critic",
  "human",
  "system",
]);

function isLayerStatus(
  value: unknown,
): value is NonNullable<ProjectLayer["status"]> {
  return (
    typeof value === "string" &&
    LAYER_STATUSES.has(value as NonNullable<ProjectLayer["status"]>)
  );
}

function isTurnRole(
  value: unknown,
): value is NonNullable<ProjectLayerTurn["role"]> {
  return (
    typeof value === "string" &&
    TURN_ROLES.has(value as NonNullable<ProjectLayerTurn["role"]>)
  );
}

/** Field-level salvage for a layer's session fields (status/maxRounds). */
function salvageSessionLayerFields(
  rawLayer: Record<string, unknown>,
  layerId: string,
  logger?: LoggerPort,
): Pick<ProjectLayer, "status" | "maxRounds"> {
  const out: {
    status?: NonNullable<ProjectLayer["status"]>;
    maxRounds?: number;
  } = {};
  if (rawLayer.status !== undefined) {
    if (isLayerStatus(rawLayer.status)) out.status = rawLayer.status;
    else
      logger?.warn(
        `[saved-projects] dropping invalid status on ${layerId} (layer kept)`,
      );
  }
  if (rawLayer.maxRounds !== undefined) {
    if (
      typeof rawLayer.maxRounds === "number" &&
      Number.isFinite(rawLayer.maxRounds) &&
      rawLayer.maxRounds > 0
    ) {
      out.maxRounds = rawLayer.maxRounds;
    } else {
      logger?.warn(
        `[saved-projects] dropping invalid maxRounds on ${layerId} (layer kept)`,
      );
    }
  }
  return out;
}

/** Field-level salvage for a turn's session fields (role/round). */
function salvageSessionTurnFields(
  rawTurn: Record<string, unknown>,
  layerId: string,
  logger?: LoggerPort,
): Pick<ProjectLayerTurn, "role" | "round"> {
  const out: {
    role?: NonNullable<ProjectLayerTurn["role"]>;
    round?: number;
  } = {};
  if (rawTurn.role !== undefined) {
    if (isTurnRole(rawTurn.role)) out.role = rawTurn.role;
    else
      logger?.warn(
        `[saved-projects] dropping invalid turn role on ${layerId} (turn kept)`,
      );
  }
  if (rawTurn.round !== undefined) {
    if (typeof rawTurn.round === "number" && Number.isFinite(rawTurn.round)) {
      out.round = rawTurn.round;
    } else {
      logger?.warn(
        `[saved-projects] dropping invalid turn round on ${layerId} (turn kept)`,
      );
    }
  }
  return out;
}
// ─── end Phase-3 live-session field salvage ─────────────────────────────────

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
    // `kind` drives UI affordances (badges, per-kind actions), so an unknown or
    // missing value defaults to the base kind rather than flowing through as an
    // unrenderable label — metadata damage never deletes the layer.
    let kind: ProjectLayer["kind"];
    if (rawLayer.kind === "brainstorm" || rawLayer.kind === "decisions") {
      kind = rawLayer.kind;
    } else {
      logger?.warn(
        `[saved-projects] unknown/missing layer kind on ${layerId}; defaulting to "brainstorm"`,
      );
      kind = "brainstorm";
    }
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
        // Phase-3 session fields — field-level salvage, never drops the turn.
        ...salvageSessionTurnFields(rawTurn, layerId, logger),
      });
    });

    // --- Phase-2 provenance fields (link / sourceLayerId) -------------------
    // Field-level salvage only: malformed provenance metadata is dropped (and
    // logged), never the layer carrying it. An explicit `null` is deliberately
    // treated as absent (the JSON convention for "no value") — silent, no warn.
    let link: ProjectLayer["link"];
    if (rawLayer.link !== undefined && rawLayer.link !== null) {
      if (
        isRecord(rawLayer.link) &&
        rawLayer.link.type === "produced-manifest" &&
        Number.isFinite(rawLayer.link.at)
      ) {
        link = {
          type: "produced-manifest",
          at: rawLayer.link.at as number,
        };
      } else {
        logger?.warn(
          `[saved-projects] dropping malformed link on ${layerId} — unknown type or bad timestamp`,
        );
      }
    }
    let sourceLayerId: string | undefined;
    if (
      rawLayer.sourceLayerId !== undefined &&
      rawLayer.sourceLayerId !== null
    ) {
      if (
        typeof rawLayer.sourceLayerId === "string" &&
        rawLayer.sourceLayerId
      ) {
        sourceLayerId = rawLayer.sourceLayerId;
      } else {
        logger?.warn(
          `[saved-projects] dropping non-string sourceLayerId on ${layerId}`,
        );
      }
    }
    // --- end Phase-2 provenance fields --------------------------------------

    layers.push({
      id: layerId,
      kind,
      title,
      turns,
      createdAt,
      updatedAt,
      ...(link !== undefined ? { link } : {}),
      ...(sourceLayerId !== undefined ? { sourceLayerId } : {}),
      // Phase-3 session fields — field-level salvage, never drops the layer.
      ...salvageSessionLayerFields(rawLayer, layerId, logger),
    });
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
    const record: Record<string, unknown> = isRecord(entry) ? entry : {};

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

  /**
   * In-tab write serialization: every write is a get-then-set on ONE IDB key,
   * so two interleaved writes (e.g. a live-session turn append racing a
   * pause's status patch, or a whole-array autosave) could read the same
   * snapshot and the later set() would silently drop the earlier one. The
   * adapter is wired as a singleton, so chaining all writes through one
   * promise queue makes them atomic relative to each other, in call order.
   * (Cross-tab races remain out of scope — same as before this queue.)
   */
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(op, op);
    // Keep the chain alive on failure; the caller still sees the rejection.
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

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
    return this.enqueueWrite(async () => {
      try {
        await set(SAVED_PROJECTS_KEY, projects);
        return { success: true as const, value: undefined };
      } catch (e) {
        return { success: false as const, error: mapWriteError(e) };
      }
    });
  }

  /**
   * Record-level create: fresh read at write time, duplicate-id → `Conflict`
   * (never a silent overwrite), new record PREPENDED, siblings written back
   * byte-identical. Queued like every other write so it can't interleave with
   * an in-flight read-merge-write.
   */
  async createProjectRecord(
    project: SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    return this.enqueueWrite(async () => {
      try {
        const data = await get(SAVED_PROJECTS_KEY);
        const raw: unknown[] = Array.isArray(data) ? data : [];
        if (raw.some((entry) => isRecord(entry) && entry.id === project.id)) {
          return {
            success: false as const,
            error: {
              kind: "Conflict" as const,
              message: `A saved project with id ${project.id} already exists`,
            },
          };
        }
        await set(SAVED_PROJECTS_KEY, [project, ...raw]);
        return { success: true as const, value: project };
      } catch (e) {
        return { success: false as const, error: mapWriteError(e) };
      }
    });
  }

  /**
   * Record-level delete: fresh read, filter out the matching record, siblings
   * written back byte-identical. IDEMPOTENT by contract (see the port): an
   * absent id resolves success WITHOUT a write — "already deleted" is the
   * desired end state, not an error, and surfacing it as one would trip the
   * hook's optimistic-revert arm and resurrect the row locally.
   */
  async deleteProjectRecord(
    id: string,
  ): Promise<Result<void, PersistenceError>> {
    return this.enqueueWrite(async () => {
      try {
        const data = await get(SAVED_PROJECTS_KEY);
        const raw: unknown[] = Array.isArray(data) ? data : [];
        const next = raw.filter(
          (entry) => !(isRecord(entry) && entry.id === id),
        );
        // Idempotent no-op: nothing matched, nothing to write.
        if (next.length === raw.length) {
          return { success: true as const, value: undefined };
        }
        await set(SAVED_PROJECTS_KEY, next);
        return { success: true as const, value: undefined };
      } catch (e) {
        return { success: false as const, error: mapWriteError(e) };
      }
    });
  }

  /**
   * Read-merge-write single-record update (the Phase-3 clobber-safety
   * precondition): a FRESH read of the stored array at write time, `updater`
   * applied to the matching record only, every other record written back
   * byte-identical. A caller's stale in-memory snapshot therefore cannot
   * revert other projects' recent writes — the failure mode of every
   * whole-array `saveProjects` from a per-instance snapshot.
   */
  async updateProjectRecord(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    return this.enqueueWrite(() =>
      this.updateProjectRecordUnqueued(id, updater),
    );
  }

  private async updateProjectRecordUnqueued(
    id: string,
    updater: (project: SavedProject) => SavedProject,
  ): Promise<Result<SavedProject, PersistenceError>> {
    try {
      const data = await get(SAVED_PROJECTS_KEY);
      const raw: unknown[] = Array.isArray(data) ? [...data] : [];
      const index = raw.findIndex(
        (entry) => isRecord(entry) && entry.id === id,
      );
      if (index === -1) {
        return {
          success: false,
          error: {
            kind: "NotFound",
            message: `No saved project with id ${id}`,
          },
        };
      }
      const record = raw[index] as Record<string, unknown>;
      // Hand the updater a record whose `layers` are salvaged like the load
      // path (layer mutations are the primary caller); every other field —
      // including possibly-drifted formState — passes through untouched.
      const current = {
        ...(record as unknown as SavedProject),
        layers: normalizeLayers(record.layers, id, this.logger),
      } as SavedProject;
      const updated = updater(current);
      // Same-reference return = "nothing changed" — skip the write entirely.
      if (updated === current) return { success: true, value: current };
      raw[index] = updated;
      await set(SAVED_PROJECTS_KEY, raw);
      return { success: true, value: updated };
    } catch (e) {
      return { success: false, error: mapWriteError(e) };
    }
  }
}

function mapWriteError(e: unknown): PersistenceError {
  if (e instanceof DOMException && e.name === "QuotaExceededError") {
    return {
      kind: "StorageQuotaExceeded",
      message: "IDB storage quota exceeded",
    };
  }
  return {
    kind: "SerializationFailed",
    message: "Failed to save projects to IDB",
    cause: e,
  };
}
