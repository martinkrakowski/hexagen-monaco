import type { ZodSchema } from "zod";
import type {
  LLMClientPort,
  LLMCallOptions,
  LLMResponse,
} from "../../../domain/ports/out/llm-client.port";
import type { LLMError } from "../errors/llm-errors";
import { MODELS } from "../constants/models";
import { XaiLLMClientAdapter } from "../adapters/xai-llm-client.adapter";
import { OpenAILLMClientAdapter } from "../adapters/openai-llm-client.adapter";
import { AnthropicLLMClientAdapter } from "../adapters/anthropic-llm-client.adapter";
import { OllamaLLMClientAdapter } from "../adapters/ollama-llm-client.adapter";
import { AzureOpenAILLMClientAdapter } from "../adapters/azure-openai-llm-client.adapter";
import {
  registeredProviders,
  type ProviderModels,
} from "./provider-registry";
import type { Result } from "../../../../shared/result";

export type CallType = "orchestration" | "wizard" | "fast" | "vision";

interface ResolvedTarget {
  adapter: LLMClientPort;
  model: string;
}

export type LLMRouterOptions = LLMCallOptions & { callType?: CallType };

export class LLMRouter implements LLMClientPort {
  private readonly adapters: Map<string, LLMClientPort>;
  private readonly models: Map<string, ProviderModels>;
  private readonly primaryProvider: string;

  // `string` (not the built-in `Provider` union) so addon-registered providers
  // — e.g. "bedrock" via the provider-registry seam — are accepted too.
  constructor(primaryProvider: string = "xai") {
    this.primaryProvider = primaryProvider;
    this.adapters = new Map<string, LLMClientPort>([
      ["xai", new XaiLLMClientAdapter()],
      ["openai", new OpenAILLMClientAdapter()],
      ["anthropic", new AnthropicLLMClientAdapter()],
      ["ollama", new OllamaLLMClientAdapter()],
      ["azure-openai", new AzureOpenAILLMClientAdapter()],
    ]);
    this.models = new Map<string, ProviderModels>(Object.entries(MODELS));
    // Merge providers registered by addon templates (e.g. llm-adapter-bedrock).
    for (const [name, reg] of registeredProviders()) {
      this.adapters.set(name, reg.factory());
      this.models.set(name, reg.models);
    }
  }

  async call(
    prompt: string,
    options: LLMRouterOptions = {},
  ): Promise<Result<LLMResponse, LLMError>> {
    const { callType = "fast", ...rest } = options;
    const { adapter, model } = this.resolve(callType);
    return adapter.call(prompt, { ...rest, model });
  }

  async callStructured<T>(
    prompt: string,
    schema: ZodSchema<T>,
    options: LLMRouterOptions = {},
  ): Promise<Result<T, LLMError>> {
    const { callType = "fast", ...rest } = options;
    const { adapter, model } = this.resolve(callType);
    return adapter.callStructured(prompt, schema, { ...rest, model });
  }

  private resolve(callType: CallType): ResolvedTarget {
    const provider = this.primaryProvider;
    const adapter = this.adapters.get(provider);
    const providerModels = this.models.get(provider);
    if (!adapter || !providerModels) {
      throw new Error(`Unknown LLM provider: ${provider}`);
    }

    const model: string = (() => {
      switch (callType) {
        case "orchestration":
          return providerModels.reasoning;
        case "vision":
          return providerModels.vision;
        case "wizard":
        case "fast":
          return providerModels.fast;
      }
    })();

    return { adapter, model };
  }
}
