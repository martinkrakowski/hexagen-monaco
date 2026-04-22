import type { WizardData } from "@hexagen/shared";

/**
 * Migrated from apps/web/app/lib/wizard-assistant-context.ts
 * Adapter that serializes WizardData into a string format suitable for use as context in prompts.
 */
export class MigratedWizardContextSerializerAdapter {
  /**
   * Serializes wizard data into a string format
   * @param wizardData The wizard data to serialize
   * @returns A string representation of the wizard context
   */
  serialize(wizardData: WizardData): string {
    const parts: string[] = [];

    if (wizardData.boundedContexts && wizardData.boundedContexts.length > 0) {
      const contexts = wizardData.boundedContexts
        .map((ctx) => {
          const inbound = ctx.portConfiguration.inboundPorts.join(", ");
          const outbound = ctx.portConfiguration.outboundPorts.join(", ");
          return `- ${ctx.name} (${ctx.infrastructureTarget}): inbound=${inbound}, outbound=${outbound}`;
        })
        .join("\n");
      parts.push(`BOUNDED CONTEXTS:\n${contexts}`);
    }

    if (wizardData.externalContexts && wizardData.externalContexts.length > 0) {
      const externals = wizardData.externalContexts
        .map((ctx) => `- ${ctx.name}: ${ctx.relationshipType}`)
        .join("\n");
      parts.push(`EXTERNAL CONTEXTS:\n${externals}`);
    }

    if (wizardData.peerMappings && wizardData.peerMappings.length > 0) {
      const peers = wizardData.peerMappings
        .map(
          (p) =>
            `- ${p.consumerContext} -> ${p.providerContext} (${p.integrationPattern})`,
        )
        .join("\n");
      parts.push(`PEER MAPPINGS:\n${peers}`);
    }

    const g = wizardData.governance;
    parts.push(`WORKSPACE: ${g.workspaceName} (${g.workspaceTemplate})`);

    if (g.topologyStrictness) {
      parts.push(`TOPOLOGY: ${g.topologyStrictness}`);
    }

    return parts.length > 0
      ? parts.join("\n\n")
      : "No wizard configuration available.";
  }
}
