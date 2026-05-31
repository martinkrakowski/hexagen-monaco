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
    // Honour the lazy `factory` contract: only the *selected* provider's adapter
    // is instantiated — unused addon adapters (and their SDK clients) are never
    // built. A registered name may not shadow a built-in.
    for (const [name, reg] of registeredProviders()) {
      if (this.adapters.has(name)) {
        throw new Error(
          `Registered LLM provider "${name}" collides with a built-in provider.`,
        );
      }
      this.models.set(name, reg.models);
      if (name === primaryProvider) {
        this.adapters.set(name, reg.factory());
      }
    }
    // Fail fast at construction (a config error) with an actionable message —
    // the usual cause for an addon provider is a missing registration
    // side-effect import. Because this validates here, `resolve()` (and thus
    // `call()`) never has to handle an unknown provider.
    if (!this.adapters.has(primaryProvider)) {
      const known = [...this.adapters.keys(), ...registeredProviders().keys()];
      throw new Error(
        `Unknown LLM provider "${primaryProvider}". Available: ${known.join(", ")}. ` +
          `If it is an addon provider (e.g. "bedrock"), import its registration module once at ` +
          `startup before constructing LLMRouter — e.g. ` +
          `import "./infrastructure/llm/adapters/bedrock-register";`,
      );
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
    // The constructor validated the primary provider, so its adapter and models
    // are present — resolve never throws, keeping call()/callStructured() within
    // the Result contract.
    const adapter = this.adapters.get(provider)!;
    const providerModels = this.models.get(provider)!;

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
