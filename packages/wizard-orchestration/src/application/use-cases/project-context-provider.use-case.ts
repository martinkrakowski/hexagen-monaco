import type { Result } from "@hexagen/shared";
import type {
  WizardData,
  BoundedContext,
  ExternalContext,
  PeerMapping,
} from "@hexagen/shared";

export interface ProjectContext {
  boundedContexts: BoundedContext[];
  externalContexts: ExternalContext[];
  peerMappings: PeerMapping[];
  currentStep: string;
  workspaceTemplate: string;
  workspaceName: string;
  summary: ProjectSummary;
}

export interface ProjectSummary {
  totalContexts: number;
  totalPorts: number;
  totalAdapters: number;
  totalPeerMappings: number;
  contextNames: string[];
  externalContextNames: string[];
}

export interface ProvideProjectContextInput {
  wizardData: WizardData;
  currentStep: string;
}

export class ProjectContextProviderUseCase {
  execute(input: ProvideProjectContextInput): Result<ProjectContext> {
    const { wizardData, currentStep } = input;

    const summary = this.computeSummary(wizardData);

    const context: ProjectContext = {
      boundedContexts: wizardData.boundedContexts || [],
      externalContexts: wizardData.externalContexts || [],
      peerMappings: wizardData.peerMappings || [],
      currentStep,
      workspaceName: wizardData.governance?.workspaceName || "Untitled Project",
      workspaceTemplate:
        wizardData.governance?.workspaceTemplate || "modular-monolith",
      summary,
    };

    return { success: true, value: context };
  }

  private computeSummary(wizardData: WizardData): ProjectSummary {
    const contextNames = (wizardData.boundedContexts || []).map(
      (c) => c.name || "Unnamed",
    );
    const externalContextNames = (wizardData.externalContexts || []).map(
      (c) => c.name || "External",
    );

    const totalPorts = (wizardData.boundedContexts || []).reduce((acc, ctx) => {
      const portConfig = ctx.portConfiguration;
      const inbound = portConfig?.inboundPorts?.length || 0;
      const outbound = portConfig?.outboundPorts?.length || 0;
      return acc + inbound + outbound;
    }, 0);

    return {
      totalContexts: (wizardData.boundedContexts || []).length,
      totalPorts,
      totalAdapters: 0,
      totalPeerMappings: (wizardData.peerMappings || []).length,
      contextNames,
      externalContextNames,
    };
  }
}
