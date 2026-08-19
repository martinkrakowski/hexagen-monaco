import type {
  LoggerPort,
  ProjectLayer,
  ProjectLayerTurn,
} from "@hexagen/shared";

// Salvage policy: an invalid value drops the FIELD, never the layer or turn.
// `link`/`sourceLayerId` salvage stays with normalizeLayers (Phase-2 provenance).

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
export function salvageSessionLayerFields(
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
export function salvageSessionTurnFields(
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
