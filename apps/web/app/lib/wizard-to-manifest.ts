import type { WizardData } from "@hexagen/shared";

export function wizardToManifest(
  wizardData: WizardData,
): Record<string, unknown> {
  return {
    system: wizardData.workspaceScope || "hexagen-project",
    apps:
      wizardData.externalContexts?.map((ext) => ({
        name: ext.name,
        type: "web",
        depends_on:
          wizardData.peerMappings
            ?.filter((m) => m.consumerContext === ext.id)
            ?.map((m) => m.providerContext) || [],
      })) || [],
    bounded_contexts:
      wizardData.boundedContexts?.map((bc) => ({
        name: bc.name,
        description: bc.description || "",
        layers: {
          domain: {
            entities: bc.coreDomainEntities || [],
            value_objects: bc.valueObjects || [],
            domain_services: [],
          },
          application: {
            use_cases: bc.useCases || [],
            ports: {
              in: [],
              out: [],
            },
          },
          infrastructure: {
            adapters: [],
          },
        },
      })) || [],
  };
}
