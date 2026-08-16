/**
 * Wizard-slice configuration: the step ledger and its id→index lookup.
 *
 * This file used to double as the app's shared project-config vocabulary
 * (option lists, the `emptyFormValues` preset, and bare re-exports of
 * `@hexagen/project-configuration`). Those were slice-agnostic, so other
 * slices reached them through `@/project-wizard/config` alias imports — a
 * cross-slice coupling the boundary gate had to pin, and one ADR-0034
 * records as having forced a hand-synced fork of the preset instead.
 * They now live in `lib/project-config-options.ts` and
 * `lib/project-config-presets.ts`; import the schema and types from
 * `@hexagen/project-configuration` directly.
 *
 * `wizardSteps` / `stepIndexById` are genuinely wizard-specific and stay here.
 */

export const wizardSteps = [
  {
    id: "workspace_governance",
    title: "Workspace Governance",
    description: "Define workspace name, package manager, and topology.",
    fields: ["governance"],
  },
  {
    // ADR-0041: project-level Applications (UI framework + API backend), placed
    // before Bounded Contexts so the choice frames domain modelling and new
    // contexts inherit it at creation. Writes the per-context fields via fan-out.
    id: "applications",
    title: "Applications",
    description: "Choose the UI framework and API backend for your project.",
    fields: ["boundedContexts"],
  },
  {
    id: "bounded_contexts",
    title: "Bounded Contexts",
    description: "Add and configure bounded contexts for your project.",
    fields: ["boundedContexts"],
  },
  {
    id: "peer_mappings",
    title: "Peer Context Mappings",
    description: "Define how contexts interact with each other.",
    fields: ["peerMappings"],
  },
  {
    id: "ports_configuration",
    title: "Ports Configuration",
    description: "Configure inbound and outbound ports for each context.",
    fields: ["boundedContexts"],
  },
  {
    id: "add_ons",
    title: "Add-On Templates",
    description: "Select production add-ons to apply after project generation.",
    fields: [],
  },
  {
    id: "template_questions",
    title: "Template Questions",
    description:
      "Answer the questions for the add-on templates you selected. Skipped automatically when no template needs answers.",
    fields: ["addOnsAnswers"],
  },
  {
    id: "summary",
    title: "Project Summary",
    description: "Review your project configuration.",
    fields: [],
  },
];

/**
 * Resolve a wizard step's index by its stable `id`. Step-index-dependent logic
 * (validation gates, navigation side effects, the router) looks steps up by id
 * rather than hardcoding numeric positions, so inserting/reordering a step (e.g.
 * the ADR-0041 Applications step) can't silently shift those checks.
 */
export function stepIndexById(id: string): number {
  const index = wizardSteps.findIndex((step) => step.id === id);
  if (index === -1) {
    // Fail fast: callers gate/reset on this index, so a drifted id must surface
    // immediately rather than silently returning -1 (which disables the gate).
    throw new Error(
      `stepIndexById: unknown wizard step id "${id}" — check wizardSteps.`,
    );
  }
  return index;
}
