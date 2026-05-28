import type { ConnectionHealthState } from "./connection-health-state.vo.js";

export interface RefinementEngine {
  id: string; // e.g. "openai", "anthropic", "ENV", "BYOK"
  name: string; // e.g. "OpenAI", "Anthropic", "Environment Default"
  type: "ENV" | "BYOK";
  healthState: ConnectionHealthState;
}

export interface RefinementEngineOption {
  id: string;
  label: string; // e.g. "OpenAI (BYOK)" or "Environment (ENV)"
  type: "ENV" | "BYOK";
  healthState: ConnectionHealthState;
}

/**
 * Filters out UNAVAILABLE or UNVALIDATED engines, keeping only VALID or DEGRADED.
 */
export function filterValidEngines(
  engines: RefinementEngine[],
): RefinementEngine[] {
  return engines.filter(
    (e) => e.healthState === "VALID" || e.healthState === "DEGRADED",
  );
}

/**
 * Returns an ordered list of refinement engines (BYOK first, then ENV).
 * If types are the same, order alphabetically by name.
 */
export function sortEngines(engines: RefinementEngine[]): RefinementEngine[] {
  return [...engines].sort((a, b) => {
    if (a.type !== b.type) {
      // BYOK first, then ENV
      return a.type === "BYOK" ? -1 : 1;
    }
    // Alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

/**
 * Maps RefinementEngine to RefinementEngineOption with label "name (type)".
 */
export function mapToOptions(
  engines: RefinementEngine[],
): RefinementEngineOption[] {
  return engines.map((e) => ({
    id: e.id,
    label: `${e.name} (${e.type})`,
    type: e.type,
    healthState: e.healthState,
  }));
}

/**
 * Resolves the default refinement engine based on the priority rule:
 * - BYOK takes precedence over ENV when both are in VALID health states.
 * - Otherwise, picks the first engine from the prioritized sorted list.
 * - If list is empty, returns null.
 */
export function resolveDefaultEngine(
  engines: RefinementEngine[],
): RefinementEngine | null {
  const validEngines = filterValidEngines(engines);
  if (validEngines.length === 0) {
    return null;
  }

  // Find if there is a VALID BYOK engine
  const validByok = validEngines.find(
    (e) => e.type === "BYOK" && e.healthState === "VALID",
  );
  if (validByok) {
    // If a VALID BYOK engine exists, check if there is also a VALID ENV engine.
    // If both exist, BYOK takes precedence.
    return validByok;
  }

  // Otherwise, sort them according to prioritized order (BYOK first, then ENV) and pick the first one.
  const sorted = sortEngines(validEngines);
  return sorted[0] || null;
}

/**
 * Resolves the active refinement engine:
 * - If there is a user override selection, check if that engine exists and is in a selectable state (VALID or DEGRADED).
 * - If so, return that engine.
 * - Otherwise, return the resolved default engine.
 */
export function resolveActiveEngine(
  engines: RefinementEngine[],
  userOverrideId: string | null,
): RefinementEngine | null {
  const validEngines = filterValidEngines(engines);
  if (validEngines.length === 0) {
    return null;
  }

  if (userOverrideId) {
    const overrideEngine = validEngines.find((e) => e.id === userOverrideId);
    if (overrideEngine) {
      return overrideEngine;
    }
  }

  return resolveDefaultEngine(engines);
}
