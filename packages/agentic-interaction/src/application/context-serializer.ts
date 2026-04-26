import type { LLMMessage } from "../domain/ports/llm-provider.port";
import type { WizardData } from "@hexagen/project-configuration";

export interface ProjectContextInput {
  wizardData: WizardData;
  currentStep: string;
}

export interface ProjectSummary {
  totalContexts: number;
  totalPorts: number;
  totalAdapters: number;
  totalPeerMappings: number;
  contextNames: string[];
  externalContextNames: string[];
}

export interface ContextSerializerOptions {
  includeDetailedConfig?: boolean;
  maxContexts?: number;
}

function computeSummary(wizardData: WizardData): ProjectSummary {
  const boundedContexts = wizardData.boundedContexts || [];
  const externalContexts = wizardData.externalContexts || [];
  const peerMappings = wizardData.peerMappings || [];

  const contextNames = boundedContexts.map((c) => c?.name || "Unnamed");
  const externalContextNames = externalContexts.map(
    (c) => c?.name || "External",
  );

  const totalPorts = boundedContexts.reduce((acc, ctx) => {
    if (!ctx?.portConfiguration) return acc;
    const inbound = ctx.portConfiguration.inboundPorts?.length || 0;
    const outbound = ctx.portConfiguration.outboundPorts?.length || 0;
    return acc + inbound + outbound;
  }, 0);

  return {
    totalContexts: boundedContexts.length,
    totalPorts,
    totalAdapters: 0,
    totalPeerMappings: peerMappings.length,
    contextNames,
    externalContextNames,
  };
}

export function serializeProjectContext(
  input: ProjectContextInput,
  options: ContextSerializerOptions = {},
): string {
  const { includeDetailedConfig = false, maxContexts = 10 } = options;
  const wizardData = input.wizardData;
  const summary = computeSummary(wizardData);

  const sections: string[] = [];

  sections.push(
    `# Project: ${wizardData.governance?.workspaceName || "Untitled Project"}`,
  );
  sections.push(`## Summary`);
  sections.push(`- Total Bounded Contexts: ${summary.totalContexts}`);
  sections.push(`- Total Ports: ${summary.totalPorts}`);
  sections.push(`- Current Wizard Step: ${input.currentStep}`);
  sections.push(
    `- Workspace Template: ${wizardData.governance?.workspaceTemplate || "modular-monolith"}`,
  );

  sections.push(`## Bounded Contexts`);
  const contextsToShow = (wizardData.boundedContexts || []).slice(
    0,
    maxContexts,
  );
  for (const ctx of contextsToShow) {
    if (!ctx) continue;
    sections.push(`### ${ctx.name || "Unnamed"}`);
    if (ctx.description) {
      sections.push(`- Description: ${ctx.description}`);
    }
    sections.push(`- Infrastructure: ${ctx.infrastructureTarget}`);
    sections.push(`- API: ${ctx.apiFramework}, UI: ${ctx.uiFramework}`);

    const portConfig = ctx.portConfiguration;
    if (portConfig) {
      const inboundPorts = portConfig.inboundPorts?.join(", ") || "None";
      const outboundPorts = portConfig.outboundPorts?.join(", ") || "None";
      sections.push(`- Inbound Ports: ${inboundPorts}`);
      sections.push(`- Outbound Ports: ${outboundPorts}`);
    }

    if (includeDetailedConfig && ctx.coreDomainEntities?.length) {
      sections.push(`- Domain Entities: ${ctx.coreDomainEntities.join(", ")}`);
    }
  }

  if (summary.totalContexts > maxContexts) {
    sections.push(
      `... and ${summary.totalContexts - maxContexts} more contexts`,
    );
  }

  const externalContexts = wizardData.externalContexts || [];
  if (externalContexts.length) {
    sections.push(`## External Contexts`);
    for (const ext of externalContexts) {
      if (!ext) continue;
      sections.push(`- ${ext.name}: ${ext.relationshipType || "external"}`);
    }
  }

  const peerMappings = wizardData.peerMappings || [];
  if (peerMappings.length) {
    sections.push(`## Peer Mappings`);
    for (const mapping of peerMappings) {
      if (!mapping) continue;
      sections.push(
        `- ${mapping.consumerContext} → ${mapping.providerContext} (${mapping.integrationPattern})`,
      );
    }
  }

  return sections.join("\n");
}

export function buildContextForLLM(input: ProjectContextInput): LLMMessage[] {
  const contextText = serializeProjectContext(input);
  const systemPrompt = `You are an AI Architecture Assistant for a Hexagonal Architecture design tool called HexaGen.
Your role is to help users design bounded contexts, suggest ports and adapters, review architecture, and provide actionable recommendations.

Current project context:
${contextText}

When providing suggestions:
1. Be specific about bounded context names and their purpose
2. Reference actual port types (inbound/outbound) when suggesting architecture changes
3. Consider the relationships between contexts when suggesting peer mappings
4. Provide confidence scores for your recommendations
5. If you propose changes to the manifest, explain the rationale

Always respond with structured, actionable recommendations.`;

  return [{ role: "system", content: systemPrompt }];
}
