import type { WizardData } from "@hexagen/shared";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { emptyFormValues } from "@/components/project-wizard/config";

export function wizardDataToFormValues(wizardData: WizardData): ProjectConfig {
  const src = wizardData.governance;
  const fallback = emptyFormValues.governance;
  return {
    ...emptyFormValues,
    governance: {
      workspaceName: src?.workspaceName ?? fallback.workspaceName,
      workspaceTemplate: src?.workspaceTemplate ?? fallback.workspaceTemplate,
      workspaceDescription: src?.workspaceDescription,
      packageManager: src?.packageManager ?? fallback.packageManager,
      topologyStrictness:
        src?.topologyStrictness ?? fallback.topologyStrictness,
      namespacePrefix: src?.namespacePrefix ?? fallback.namespacePrefix,
      namingConventions: {
        contextDirectoryPattern:
          src?.namingConventions?.contextDirectoryPattern ??
          fallback.namingConventions.contextDirectoryPattern,
        adapterSuffix:
          src?.namingConventions?.adapterSuffix ??
          fallback.namingConventions.adapterSuffix,
      },
    },
    boundedContexts: (wizardData.boundedContexts || []).map((bc) => ({
      id: bc.id,
      name: bc.name,
      description: bc.description,
      infrastructureTarget: bc.infrastructureTarget,
      coreDomainEntities: bc.coreDomainEntities ?? [],
      valueObjects: bc.valueObjects ?? [],
      domainEvents: bc.domainEvents ?? [],
      useCases: bc.useCases ?? [],
      portConfiguration: bc.portConfiguration ?? {
        inboundPorts: [],
        outboundPorts: [],
      },
      apiFramework: bc.apiFramework,
      uiFramework: bc.uiFramework,
      persistenceAdapter: bc.persistenceAdapter,
      messagingAdapter: bc.messagingAdapter,
      telemetryProvider: bc.telemetryProvider,
    })),
    externalContexts: (wizardData.externalContexts || []).map((ec) => ({
      id: ec.id,
      name: ec.name,
      relationshipType: ec.relationshipType,
      isEventDriven: ec.isEventDriven,
      entityNames: ec.entityNames,
      useCaseNames: ec.useCaseNames,
    })),
    peerMappings: (wizardData.peerMappings || []).map((pm) => ({
      consumerContext: pm.consumerContext,
      providerContext: pm.providerContext,
      integrationPattern: pm.integrationPattern,
      communicationBoundary: pm.communicationBoundary,
    })),
  };
}
