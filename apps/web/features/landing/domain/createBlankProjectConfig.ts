import type { ProjectConfig } from "@hexagen/project-configuration";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";

/**
 * Build a fresh blank-project config for the "Start Blank" stream.
 *
 * The user-entered project name seeds both `governance.workspaceName` (the
 * slug, via the shared `deriveWorkspaceName`) and `governance.namespacePrefix`
 * (`@<slug>`), so the name is factored into generated output — `wizardToManifest`
 * maps `workspaceName`/`namespacePrefix` to the manifest `system`/`scope`. Both
 * stay editable in the wizard's Workspace Governance step.
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
      namespacePrefix: `@${workspaceName}`,
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
