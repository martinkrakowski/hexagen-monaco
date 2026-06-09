import type { BoundedContext } from "@hexagen/project-configuration";

/**
 * Project-level Applications selection (ADR-0041). UI framework + API/infra
 * target are a single project-wide choice presented in the Applications step;
 * they are NOT per-context concerns. The persisted source of truth remains the
 * per-context `uiFramework` / `infrastructureTarget` fields — the Applications
 * step fans this selection out to every context so `deriveApps` collapses them
 * into one `web` + one `api`.
 */
export type UiFramework = NonNullable<BoundedContext["uiFramework"]>;
export type InfrastructureTarget = NonNullable<
  BoundedContext["infrastructureTarget"]
>;

export interface ApplicationsSelection {
  uiFramework: UiFramework;
  infrastructureTarget: InfrastructureTarget;
}

export interface ApplicationsCollapse extends ApplicationsSelection {
  /** Two or more contexts carried different non-empty UI frameworks. */
  uiDiverged: boolean;
  /** Two or more contexts carried different non-empty infra targets. */
  infraDiverged: boolean;
}

/**
 * Fallback infra target when no context declares one (e.g. a legacy manifest
 * predating `infrastructureTarget`). Distinct from the deliberate `"none"`
 * (no API backend) choice: this is the default for an *unset* field, so it picks
 * the single-app preset's `nitro`. (`uiFramework` has the parallel `""` =
 * headless choice, but its unset default is also a real framework.)
 */
const DEFAULT_INFRA_TARGET: InfrastructureTarget = "nitro";

/**
 * Compute the Applications step's initial selection from the per-context fields
 * (ADR-0041 D4 — a load-time presentation collapse, NOT a data migration):
 *
 *  - **First non-empty wins**, in context order, for each field.
 *  - `uiFramework` defaults to `""` (headless preserved) when no context
 *    declares one — so a deliberately headless project is not silently flipped
 *    to a UI framework on load/save. New projects opt into a UI by seeding their
 *    first context with one (see `emptyFormValues` / `createEmptyContext`).
 *  - `infrastructureTarget` defaults to `nestjs` when none is declared.
 *  - Divergence (≥2 distinct non-empty values) is reported so the step can show
 *    an inline notice; it is never an error.
 */
export function collapseApplications(
  contexts: readonly Pick<
    BoundedContext,
    "uiFramework" | "infrastructureTarget"
  >[],
): ApplicationsCollapse {
  const uiValues = contexts
    .map((c) => c.uiFramework)
    .filter((v): v is UiFramework => Boolean(v));
  const infraValues = contexts
    .map((c) => c.infrastructureTarget)
    .filter((v): v is InfrastructureTarget => Boolean(v));

  return {
    uiFramework: uiValues[0] ?? "",
    infrastructureTarget: infraValues[0] ?? DEFAULT_INFRA_TARGET,
    uiDiverged: new Set(uiValues).size > 1,
    infraDiverged: new Set(infraValues).size > 1,
  };
}

/**
 * Fan the single Applications selection out to every bounded context (ADR-0041
 * D1). Returns a new array — callers persist it via react-hook-form `setValue`,
 * the single state path. Driven infra (persistence / messaging / telemetry) and
 * all other per-context fields are preserved untouched.
 */
export function fanOutApplications<
  T extends Pick<BoundedContext, "uiFramework" | "infrastructureTarget">,
>(contexts: readonly T[], selection: ApplicationsSelection): T[] {
  return contexts.map((context) => ({
    ...context,
    uiFramework: selection.uiFramework,
    infrastructureTarget: selection.infrastructureTarget,
  }));
}
