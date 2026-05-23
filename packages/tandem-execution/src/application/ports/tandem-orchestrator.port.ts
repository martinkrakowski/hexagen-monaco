import type { Result } from "@hexagen/shared";
import type { TandemTokenMetadata } from "../../domain/index.js";

export interface OrchestratorParams {
  prompt: string;
  conversationId: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  deviceMemoryGb?: number;
}

export interface OrchestratorResult {
  finalContent: string;
  stage1Draft?: string;
  tokenMetadata?: TandemTokenMetadata;
  bypassReason?: string;
}

export interface TandemOrchestratorPort {
  executePipeline(
    params: OrchestratorParams,
  ): Promise<Result<OrchestratorResult, Error>>;
}
