import type { Result } from "@hexagen/shared";
import type {
  TandemTokenMetadata,
  LocalModelState,
  ConnectionHealthState,
} from "../../domain/index.js";

export interface OrchestratorParams {
  prompt: string;
  conversationId: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  deviceMemoryGb?: number;
}

export interface TandemOrchestratorParams extends OrchestratorParams {
  /** ADR-0016 streaming guard ref. Managed by the orchestrator if not provided. */
  isStreamingRef?: { current: boolean };
  localModelState: LocalModelState;
  cloudHealthState: ConnectionHealthState;
  cloudContextLimit?: number;
  memoryThresholdGb?: number;
  byokCiphertext?: string;
  byokProvider?: string;
  onToken?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface OrchestratorResult {
  finalContent: string;
  stage1Draft?: string;
  tokenMetadata?: TandemTokenMetadata;
  bypassReason?: string;
}

export interface TandemOrchestratorPort {
  executePipeline(
    params: TandemOrchestratorParams,
  ): Promise<Result<OrchestratorResult, Error>>;
}
