import type {
  ProviderFallbackChain,
  SecretVaultPort,
} from "../../domain/provider-config.js";

export interface CloudLLMPipelineAdapterConfig {
  fallbackChain: ProviderFallbackChain;
  secretVault: SecretVaultPort;
  fetchFn?: typeof fetch;
}

export interface ChatCompletionChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}
