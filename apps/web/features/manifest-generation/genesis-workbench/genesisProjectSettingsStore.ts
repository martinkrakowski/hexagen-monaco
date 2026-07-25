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
type GenesisGovernance = ProjectConfig["governance"];

interface GenesisFormSnapshot {
  seedName: string | null;
  /**
   * The governance this flow was originally SEEDED with — the baseline the
   * edited-vs-seed diff (`loadEditedGenesisGovernance`) compares against.
   * Captured once, when the snapshot is first created for a flow, and carried
   * UNCHANGED across same-key overwrites and `rekeyGenesisFormValues`:
   * recomputing it from the current key would silently shift the baseline
   * after a bypassed-flow rekey (null → manufactured name), making the
   * untouched `@hexagen` seed defaults look like user edits on the second
   * hand-off — exactly the untouched-seed-default clobber the field-level
   * diff exists to prevent.
   */
  seedGovernance: GenesisGovernance;
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
  // Preserve the existing diff baseline when overwriting the same flow's
  // snapshot (see GenesisFormSnapshot.seedGovernance); only a NEW flow
  // (different key, or empty store) captures a fresh one from its own seed.
  const seedGovernance =
    snapshot !== null && snapshot.seedName === seedName
      ? snapshot.seedGovernance
      : seedGenesisFormValues(seedName).governance;
  snapshot = { seedName, seedGovernance, values };
}

/**
 * Moves the current snapshot from one seed key to another. Used by the
 * genesis hand-off (`handleUseManifest`) when the Project Name step was
 * bypassed: the flow manufactures a project name there, and the accept
 * screen re-attaches it as `?name=` on Back/Regenerate — so the null-keyed
 * Section A edits must follow that name or the remounted page would miss
 * the snapshot and reseed, wiping them. No-ops when the snapshot is empty
 * or belongs to a different flow (its key is not `fromSeed`).
 *
 * The `seedGovernance` diff baseline travels with the snapshot UNCHANGED —
 * the rekey moves the same flow's edits under a new key, it does not start
 * a new flow, so the edited-vs-seed comparison must keep judging against
 * the seed the user actually started from.
 */
export function rekeyGenesisFormValues(
  fromSeed: string | null,
  toSeed: string | null,
): void {
  if (snapshot === null || snapshot.seedName !== fromSeed) return;
  snapshot = {
    seedName: toSeed,
    seedGovernance: snapshot.seedGovernance,
    values: snapshot.values,
  };
}

/**
 * Drops the snapshot. Two callers: the genesis footer's Back EXIT — leaving
 * the flow must not leak an abandoned attempt's edits into a later visit
 * that shares the seed key (the null key of unnamed entries especially) —
 * and the accept screen's SUCCESSFUL save (Plan Workbench C2), so a finished
 * flow can't leak either. The accept screen's Back/Regenerate deliberately
 * do NOT call this — surviving those round trips is the store's whole purpose.
 */
export function clearGenesisFormValues(): void {
  snapshot = null;
}

/**
 * The Section A governance fields whose snapshot values differ from the
 * flow's own seed — i.e. the fields the user actually EDITED (Plan Workbench
 * C2, locked plan §5 Q5). `handleUseManifest` gives these top precedence
 * (edited > carriedName-derived > AI-derived).
 *
 * Field-level comparison against the flow's ORIGINAL seed matters: the
 * snapshot exists
 * after ANY Section A edit, so treating its whole governance object as
 * "edited" would let an untouched seed default (e.g. the bypassed flow's
 * `@hexagen` workspaceName, or the seed's template) clobber the AI-derived
 * value the user never overrode. Blank/whitespace identity values also count
 * as not-edited — an emptied field must fall through the precedence chain,
 * never become the manifest's `system`/`scope`.
 *
 * The baseline is the snapshot's own `seedGovernance` — NOT a seed recomputed
 * from the current key: after a bypassed-flow rekey the current key's seed
 * (`createBlankProjectConfig(manufacturedName)`) differs from the seed the
 * user actually started from on exactly the identity fields, and diffing
 * against it would report the untouched defaults as edits on the second
 * hand-off.
 *
 * workspaceDescription is deliberately excluded: the AI-derived manifest
 * description is the accept screen's source of truth and its reconciliation
 * is out of C2's scope.
 */
export interface EditedGenesisGovernance {
  workspaceName?: string;
  namespacePrefix?: string;
  packageManager?: GenesisGovernance["packageManager"];
  workspaceTemplate?: GenesisGovernance["workspaceTemplate"];
  namingConventions?: GenesisGovernance["namingConventions"];
}

export function loadEditedGenesisGovernance(
  seedName: string | null,
): EditedGenesisGovernance {
  if (snapshot === null || snapshot.seedName !== seedName) return {};
  const seed = snapshot.seedGovernance;
  const current = snapshot.values.governance;
  const edited: EditedGenesisGovernance = {};

  const workspaceName = current.workspaceName.trim();
  if (workspaceName && workspaceName !== seed.workspaceName) {
    edited.workspaceName = workspaceName;
  }
  const namespacePrefix = current.namespacePrefix.trim();
  if (namespacePrefix && namespacePrefix !== seed.namespacePrefix) {
    edited.namespacePrefix = namespacePrefix;
  }
  if (current.packageManager !== seed.packageManager) {
    edited.packageManager = current.packageManager;
  }
  if (current.workspaceTemplate !== seed.workspaceTemplate) {
    edited.workspaceTemplate = current.workspaceTemplate;
  }
  if (
    current.namingConventions.contextDirectoryPattern !==
      seed.namingConventions.contextDirectoryPattern ||
    current.namingConventions.adapterSuffix !==
      seed.namingConventions.adapterSuffix
  ) {
    edited.namingConventions = { ...current.namingConventions };
  }
  return edited;
}
