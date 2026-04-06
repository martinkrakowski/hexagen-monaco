import type { LLMMessage } from "./llm-provider.port";
import type { Result } from "@hexagen/shared";

export interface SuggestionContext {
  projectManifest?: string;
  boundedContexts?: string[];
  recentIntents?: string[];
  canvasState?: string;
  currentStep?: string;
}

export interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
  actionable: boolean;
  manifestPatch?: string;
}

export interface SuggestionRequest {
  prompt: string;
  context: SuggestionContext;
  maxSuggestions?: number;
}

export interface SuggestionEnginePort {
  generateSuggestions(
    request: SuggestionRequest,
  ): Promise<Result<AISuggestion[]>>;
  buildSystemPrompt(context: SuggestionContext): LLMMessage;
}
