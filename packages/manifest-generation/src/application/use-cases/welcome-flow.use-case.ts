import type { WelcomeScreenState } from "../../domain/services/model-selection-state-machine.js";
import type {
  ManifestTopologyDraft,
  ClarificationTrigger,
} from "@hexagen/agentic-interaction";
import type { ClientManifestGenerationPort } from "../ports/in/client-manifest-generation.port.js";
import { classifyGenerationError } from "../../domain/services/generation-error-handler.js";

export interface WelcomeFlowCallbacks {
  onTransitionTo(state: WelcomeScreenState): void;
  onError(message: string, code?: string): void;
  onSaveGenerationResult(manifest: string): void;
  onClarificationNeeded(triggers: ClarificationTrigger[]): void;
  onStepDetail(detail: string): void;
}

export interface WelcomeFlowInput {
  description: string;
  maxContexts?: number;
}

export type WelcomeFlowResult =
  | { kind: "complete"; manifest: string }
  | {
      kind: "clarification_needed";
      triggers: ClarificationTrigger[];
      partialTopology: ManifestTopologyDraft;
    }
  | { kind: "error"; code: string; message: string };

export class WelcomeFlowUseCase {
  constructor(private readonly manifestUseCase: ClientManifestGenerationPort) {}

  async execute(
    input: WelcomeFlowInput,
    signal: AbortSignal,
    callbacks: WelcomeFlowCallbacks,
  ): Promise<WelcomeFlowResult> {
    callbacks.onStepDetail("Analyzing project structure...");

    const topologyResult = await this.manifestUseCase.generateTopology(
      { description: input.description, maxContexts: input.maxContexts },
      signal,
      callbacks.onStepDetail,
    );

    if (!topologyResult.ok) {
      const classified = classifyGenerationError(topologyResult.error);
      return {
        kind: "error",
        code: classified.code,
        message: classified.message,
      };
    }

    const topology = topologyResult.topology;

    const triggers = this.manifestUseCase.checkClarificationTriggers(topology);
    if (triggers.length > 0) {
      callbacks.onClarificationNeeded(triggers);
      return {
        kind: "clarification_needed",
        triggers,
        partialTopology: topology,
      };
    }

    callbacks.onStepDetail("Extracting adapters...");
    const adaptersResult = await this.manifestUseCase.extractAdapters(
      topology,
      signal,
      callbacks.onStepDetail,
    );

    if (!adaptersResult.ok) {
      const classified = classifyGenerationError(adaptersResult.error);
      return {
        kind: "error",
        code: classified.code,
        message: classified.message,
      };
    }

    callbacks.onStepDetail("Rendering manifest...");
    const rendered = await this.manifestUseCase.renderManifest(
      adaptersResult.draft,
      signal,
    );

    callbacks.onSaveGenerationResult(rendered.yaml);
    return { kind: "complete", manifest: rendered.yaml };
  }

  async confirmClarification(
    partialTopology: ManifestTopologyDraft,
    signal: AbortSignal,
    callbacks: WelcomeFlowCallbacks,
  ): Promise<WelcomeFlowResult> {
    callbacks.onStepDetail("Extracting adapters...");
    const adaptersResult = await this.manifestUseCase.extractAdapters(
      partialTopology,
      signal,
      callbacks.onStepDetail,
    );

    if (!adaptersResult.ok) {
      const classified = classifyGenerationError(adaptersResult.error);
      return {
        kind: "error",
        code: classified.code,
        message: classified.message,
      };
    }

    callbacks.onStepDetail("Rendering manifest...");
    const rendered = await this.manifestUseCase.renderManifest(
      adaptersResult.draft,
      signal,
    );

    callbacks.onSaveGenerationResult(rendered.yaml);
    return { kind: "complete", manifest: rendered.yaml };
  }
}
