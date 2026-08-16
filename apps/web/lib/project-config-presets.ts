import type { ProjectConfig } from "@hexagen/project-configuration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";

/**
 * The single default `ProjectConfig` preset every "new project" entry point
 * starts from.
 *
 * This used to be two hand-synced copies: `emptyFormValues` in
 * `features/project-wizard/config.ts` and `createBlankProjectConfig` in
 * `features/landing/domain/`. ADR-0034 §"Trade-offs" records WHY the copy was
 * made — the feature-slice import rule forbade the landing flow from importing
 * the wizard's preset, so the preset was inlined instead — and the copy's own
 * JSDoc carried a "keep the two in sync" instruction. Both now resolve here, a
 * home neither slice owns, so the rule is satisfied without a fork.
 *
 * This module must not import from `features/` — that would invert the
 * dependency it exists to remove.
 */

/**
 * Build a fresh default project config.
 *
 * With a `projectName`, the name seeds both `governance.workspaceName` (the
 * slug, via the shared `deriveWorkspaceName`) and `governance.namespacePrefix`
 * (`@<slug>`), so the name is factored into generated output —
 * `wizardToManifest` maps `workspaceName`/`namespacePrefix` to the manifest
 * `system`/`scope`. Both stay editable in the wizard's Workspace Governance
 * step. This is the "Start Blank" / named-genesis seed.
 *
 * Without one, both fields fall back to the `@hexagen` placeholder — the
 * wizard's unnamed default (see `emptyFormValues`).
 *
 * Every call mints a NEW bounded-context id. Callers that need a stable id
 * across calls must read `emptyFormValues`, not call this.
 */
export function createDefaultProjectConfig(
  projectName?: string,
): ProjectConfig {
  const workspaceName =
    projectName === undefined
      ? "@hexagen"
      : deriveWorkspaceName(projectName).name;
  const namespacePrefix =
    projectName === undefined ? "@hexagen" : `@${workspaceName}`;

  return {
    governance: {
      workspaceName,
      workspaceTemplate: "modular-monolith",
      workspaceDescription: undefined,
      packageManager: "yarn",
      topologyStrictness: "flexible",
      namespacePrefix,
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
    boundedContexts: [
      {
        id: crypto.randomUUID(),
        name: "core",
        description: "",
        infrastructureTarget: "nitro",
        coreDomainEntities: [],
        valueObjects: [],
        domainEvents: [],
        entities: [],
        useCases: [],
        portConfiguration: {
          inboundPorts: [],
          outboundPorts: [],
        },
        // ADR-0041 single-app preset: a fresh project defaults to one Next.js web
        // app. The Applications step fans this out across contexts; a loaded
        // headless project (all uiFramework "") is preserved, not flipped.
        uiFramework: "Next.js",
        persistenceAdapter: "",
        messagingAdapter: "",
        telemetryProvider: "",
      },
    ],
    externalContexts: [],
    peerMappings: [],
    addOnsAnswers: {},
  };
}

/**
 * The wizard's unnamed default form values — a module-load SINGLETON, not a
 * per-call value.
 *
 * The distinction is load-bearing and deliberately preserved through the
 * extraction: its bounded-context id is minted ONCE, when this module is first
 * evaluated, so every reader observes the same id. Callers depend on that.
 * `analyzeManifestCompleteness.test.ts` builds a peer mapping whose
 * `providerContext` is `emptyFormValues.boundedContexts[0].id` and matches it
 * against a context spread from the same object; `genesisProjectSettingsStore`
 * `structuredClone`s it so an unnamed genesis flow's re-seed reproduces the id
 * it seeded with; and `useProjectLifecycle` resets the form to it on every
 * "new project", where a changing id would silently re-key react-hook-form
 * field arrays and any manifest projection downstream.
 *
 * Deliberately NOT frozen: freezing would be a new runtime constraint on the
 * ~20 existing readers, several of which hand the object to react-hook-form.
 *
 * Use `createDefaultProjectConfig()` when you want a fresh id per call.
 */
export const emptyFormValues: ProjectConfig = createDefaultProjectConfig();
