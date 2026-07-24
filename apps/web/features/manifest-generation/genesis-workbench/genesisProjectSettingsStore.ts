import type { ProjectConfig } from "@hexagen/project-configuration";
// Alias (not relative) cross-slice imports: the module-level lint rule only
// isolates relative feature imports; these two are the repo's canonical
// seeding sources (mirrored presets — see createBlankProjectConfig's JSDoc)
// and duplicating them here would fork the ADR-0041 single-app preset.
import { createBlankProjectConfig } from "@/landing/domain/createBlankProjectConfig";
import { emptyFormValues } from "@/project-wizard/config";

/**
 * Module-scoped store for the GENESIS "Project settings" form (Plan Workbench
 * C1, plan §3.2). The `/projects/new/ai` flow has no saved project to persist
 * to, and `usePendingManifest` is cleared on the accept screen's Back and
 * Regenerate paths — so neither React state nor the pending-manifest store can
 * carry the user's field edits across that round trip. This store lives for
 * the SPA session and nothing on the Back/Regenerate paths touches it.
 *
 * The snapshot is keyed by the flow's `?name=` seed: a NEW genesis flow
 * (different — or no — carried name) must not inherit a previous attempt's
 * edits, while the same flow's round trips must. One deliberate exception:
 * when the name step was bypassed (null seed), `handleUseManifest`
 * manufactures the project name at hand-off and the accept screen re-attaches
 * it as `?name=` on Back/Regenerate — `rekeyGenesisFormValues` moves the
 * null-keyed snapshot to that name so the flow's OWN round trip still finds
 * its edits (the mismatch is inflicted by the flow, not by a new flow).
 */
interface GenesisFormSnapshot {
  seedName: string | null;
  values: ProjectConfig;
}

let snapshot: GenesisFormSnapshot | null = null;

/**
 * The form values a fresh genesis flow starts from: the blank-project preset
 * seeded from the carried `?name=` (slug → `governance.workspaceName`,
 * `@slug` → `namespacePrefix`), or the wizard's `emptyFormValues` when the
 * Project Name step was bypassed. Cloned so form edits never mutate the
 * module-level preset.
 */
export function seedGenesisFormValues(seedName: string | null): ProjectConfig {
  return seedName
    ? createBlankProjectConfig(seedName)
    : structuredClone(emptyFormValues);
}

/**
 * Returns the surviving values for this flow, or `null` when the store is
 * empty or belongs to a different flow (different seed name).
 */
export function loadGenesisFormValues(
  seedName: string | null,
): ProjectConfig | null {
  if (snapshot === null || snapshot.seedName !== seedName) return null;
  return snapshot.values;
}

export function saveGenesisFormValues(
  seedName: string | null,
  values: ProjectConfig,
): void {
  snapshot = { seedName, values };
}

/**
 * Moves the current snapshot from one seed key to another. Used by the
 * genesis hand-off (`handleUseManifest`) when the Project Name step was
 * bypassed: the flow manufactures a project name there, and the accept
 * screen re-attaches it as `?name=` on Back/Regenerate — so the null-keyed
 * Section A edits must follow that name or the remounted page would miss
 * the snapshot and reseed, wiping them. No-ops when the snapshot is empty
 * or belongs to a different flow (its key is not `fromSeed`).
 */
export function rekeyGenesisFormValues(
  fromSeed: string | null,
  toSeed: string | null,
): void {
  if (snapshot === null || snapshot.seedName !== fromSeed) return;
  snapshot = { seedName: toSeed, values: snapshot.values };
}

/**
 * Drops the snapshot. Used by tests today; PR C2's identity reconciliation
 * wires this into the accept-save completion so a finished flow can't leak
 * its edits into the next one.
 */
export function clearGenesisFormValues(): void {
  snapshot = null;
}
