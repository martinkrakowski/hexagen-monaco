import type {
  WizardData,
  BoundedContext,
  ExternalContext,
  PeerMapping,
  WizardGovernance,
} from "@hexagen/shared";

const DEFAULT_GOVERNANCE: WizardGovernance = {
  workspaceName: "@hexagen",
  workspaceTemplate: "modular-monolith",
  packageManager: "yarn",
  topologyStrictness: "flexible",
  namespacePrefix: "@hexagen",
  namingConventions: {
    contextDirectoryPattern: "packages/",
    adapterSuffix: ".adapter.ts",
  },
};

export function buildWizardData(
  boundedContexts: BoundedContext[],
  externalContexts: ExternalContext[],
  peerMappings: PeerMapping[],
  governance?: WizardGovernance,
): WizardData {
  return {
    boundedContexts,
    externalContexts,
    peerMappings,
    governance: governance ?? DEFAULT_GOVERNANCE,
  };
}
