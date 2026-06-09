import type { ProjectConfig } from "@hexagen/project-configuration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";

/**
 * Build a fresh blank-project config for the "Start Blank" stream.
 *
 * The user-entered project name seeds `governance.workspaceName` (slugified via
 * the shared `deriveWorkspaceName`), so the name is factored into generated
 * output — `wizardToManifest` maps `workspaceName` to the manifest `system.name`.
 * `namespacePrefix` keeps its `@hexagen` default and stays editable in the
 * wizard's Workspace Governance step.
 *
 * Mirrors `emptyFormValues` in `features/project-wizard/config.ts` (the single
 * Next.js app ADR-0041 preset); keep the two in sync.
 */
export function createBlankProjectConfig(projectName: string): ProjectConfig {
  const workspaceName = deriveWorkspaceName(projectName).name;

  return {
    governance: {
      workspaceName,
      workspaceTemplate: "modular-monolith",
      workspaceDescription: undefined,
      packageManager: "yarn",
      topologyStrictness: "flexible",
      namespacePrefix: "@hexagen",
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
        // ADR-0041 single-app preset — mirror `emptyFormValues` so the "blank"
        // path seeds the same Next.js default as the wizard default (the
        // Applications step would otherwise collapse to headless).
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
