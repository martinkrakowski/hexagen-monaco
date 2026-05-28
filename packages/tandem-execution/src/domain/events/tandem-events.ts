import type { TandemTokenMetadata } from "../value-objects/tandem-token-metadata.vo.js";

export interface TandemDomainEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  source: string;
  correlationId?: string;
}

export const TANDEM_EVENT_TYPES = {
  PRE_FLIGHT_STARTED: "TANDEM_STAGE_0_PRE_FLIGHT_STARTED",
  LOCAL_SPECULATION_STARTED: "TANDEM_STAGE_1_LOCAL_SPECULATION_STARTED",
  LOCAL_SPECULATION_STREAM: "TANDEM_STAGE_1_LOCAL_SPECULATION_STREAM",
  LOCAL_SPECULATION_COMPLETED: "TANDEM_STAGE_1_LOCAL_SPECULATION_COMPLETED",
  LOCAL_SPECULATION_FAILED: "TANDEM_STAGE_1_LOCAL_SPECULATION_FAILED",
  PAYLOAD_CONSTRUCTION_STARTED: "TANDEM_STAGE_2_PAYLOAD_CONSTRUCTION_STARTED",
  PAYLOAD_CONSTRUCTION_COMPLETED:
    "TANDEM_STAGE_2_PAYLOAD_CONSTRUCTION_COMPLETED",
  CLOUD_HANDOFF_STARTED: "TANDEM_STAGE_3_CLOUD_HANDOFF_STARTED",
  CLOUD_HANDOFF_STREAM: "TANDEM_STAGE_3_CLOUD_HANDOFF_STREAM",
  CLOUD_HANDOFF_COMPLETED: "TANDEM_STAGE_3_CLOUD_HANDOFF_COMPLETED",
  CLOUD_HANDOFF_FAILED: "TANDEM_STAGE_3_CLOUD_HANDOFF_FAILED",
  FINAL_OUTPUT_COMPLETED: "TANDEM_STAGE_4_FINAL_OUTPUT_COMPLETED",
  BYOK_CIPHERTEXT_ROTATED: "TANDEM_BYOK_CIPHERTEXT_ROTATED",
} as const;

export type TandemEventPayloads = {
  [TANDEM_EVENT_TYPES.PRE_FLIGHT_STARTED]: {
    prompt: string;
    conversationId: string;
  };
  [TANDEM_EVENT_TYPES.LOCAL_SPECULATION_STARTED]: {
    prompt: string;
    conversationId: string;
    modelId: string;
  };
  [TANDEM_EVENT_TYPES.LOCAL_SPECULATION_STREAM]: {
    conversationId: string;
    chunk: string;
    fullText: string;
  };
  [TANDEM_EVENT_TYPES.LOCAL_SPECULATION_COMPLETED]: {
    conversationId: string;
    draft: string;
    tokenCount?: number;
  };
  [TANDEM_EVENT_TYPES.LOCAL_SPECULATION_FAILED]: {
    conversationId: string;
    error: string;
  };
  [TANDEM_EVENT_TYPES.PAYLOAD_CONSTRUCTION_STARTED]: {
    conversationId: string;
  };
  [TANDEM_EVENT_TYPES.PAYLOAD_CONSTRUCTION_COMPLETED]: {
    conversationId: string;
    payloadLength: number;
    truncatedDraft: boolean;
    truncatedHistory: boolean;
  };
  [TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STARTED]: {
    conversationId: string;
    provider: string;
  };
  [TANDEM_EVENT_TYPES.CLOUD_HANDOFF_STREAM]: {
    conversationId: string;
    chunk: string;
    fullText: string;
  };
  [TANDEM_EVENT_TYPES.CLOUD_HANDOFF_COMPLETED]: {
    conversationId: string;
    content: string;
    tokenMetadata?: TandemTokenMetadata;
    partial?: boolean;
  };
  [TANDEM_EVENT_TYPES.CLOUD_HANDOFF_FAILED]: {
    conversationId: string;
    error: string;
    partialContent?: string;
  };
  [TANDEM_EVENT_TYPES.FINAL_OUTPUT_COMPLETED]: {
    conversationId: string;
    finalContent: string;
    stage1Draft?: string;
    tokenMetadata?: TandemTokenMetadata;
  };
  [TANDEM_EVENT_TYPES.BYOK_CIPHERTEXT_ROTATED]: {
    conversationId: string;
    newCiphertext: string;
  };
};

export function createTandemEvent<K extends keyof TandemEventPayloads>(
  type: K,
  payload: TandemEventPayloads[K],
  correlationId?: string,
): TandemDomainEvent<TandemEventPayloads[K]> {
  return {
    type,
    payload,
    timestamp: Date.now(),
    source: "tandem-execution",
    correlationId,
  };
}
