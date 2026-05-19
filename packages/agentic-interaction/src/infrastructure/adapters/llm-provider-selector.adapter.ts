import type { Result } from "@hexagen/shared";
import type {
  DomainModelId,
  LLMRequest,
  LLMResponse,
  LocalLLMProviderPort,
  SendStructuredRequestPort,
} from "@hexagen/local-llm/client";
import type {
  ProviderFallbackChain,
  SecretVaultPort,
} from "../../domain/provider-config";
import { CloudLLMPipelineAdapter } from "./cloud-llm-pipeline.adapter";

export interface LLMProviderSelectorAdapterConfig {
  /**
   * The local WebLLM adapter to use for local processing
   */
  webLlmAdapter: (LocalLLMProviderPort & SendStructuredRequestPort) | null;

  /**
   * The fallback chain for cloud providers
   */
  fallbackChain: ProviderFallbackChain;

  /**
   * The secret vault for API keys
   */
  secretVault: SecretVaultPort;

  /**
   * The fetch function to use for network requests
   */
  fetchFn?: typeof fetch;

  /**
   * The local model to use for processing
   */
  localModelId?: DomainModelId;

  /**
   * Whether to prioritize local processing over cloud
   */
  preferLocal?: boolean;

  /**
   * Whether to validate the local LLM is properly initialized
   * before attempting to use it (adds a slight latency but prevents errors)
   */
  validateLocalLLM?: boolean;
}

/**
 * Adapter that selects between local and cloud LLM providers
 * based on availability and configuration
 */
export class LLMProviderSelectorAdapter implements SendStructuredRequestPort {
  private readonly cloudAdapter: CloudLLMPipelineAdapter;
  private readonly preferLocal: boolean;
  private readonly validateLocalLLM: boolean;

  constructor(private readonly config: LLMProviderSelectorAdapterConfig) {
    this.cloudAdapter = new CloudLLMPipelineAdapter({
      fallbackChain: config.fallbackChain,
      secretVault: config.secretVault,
      fetchFn: config.fetchFn,
    });

    this.preferLocal = config.preferLocal ?? true;
    this.validateLocalLLM = config.validateLocalLLM ?? true;
  }

  /**
   * Checks if the local LLM is available and properly initialized
   */
  private async isLocalLLMAvailable(): Promise<boolean> {
    const { webLlmAdapter } = this.config;

    if (!webLlmAdapter) return false;

    // If we don't need to validate, just check if the adapter exists
    if (!this.validateLocalLLM) return true;

    // Check if a model is loaded by getting the loaded model
    const loadedModel = webLlmAdapter.getLoadedModel();

    // If a model is already loaded, the LLM is available
    if (loadedModel) return true;

    // Check if the requested model is in cache (which means it could be loaded quickly)
    if (this.config.localModelId) {
      try {
        return await webLlmAdapter.hasModelInCache(this.config.localModelId);
      } catch {
        // If there's an error checking cache, assume the local LLM is not available
        return false;
      }
    }

    // No model specified, no model loaded
    return false;
  }

  async sendRequest(request: LLMRequest): Promise<Result<LLMResponse>> {
    // If local processing is preferred and available, try it first
    if (this.preferLocal) {
      const localAvailable = await this.isLocalLLMAvailable();

      if (localAvailable && this.config.webLlmAdapter) {
        try {
          const result = await this.config.webLlmAdapter.sendRequest(request);

          // If the result is successful, return it
          if (result.success) {
            return result;
          }

          // If local processing failed, fall back to cloud
          // This means we continue to the next section where we use cloud providers
        } catch {
          // Local processing error, fall back to cloud
          // We continue to the next section to use cloud providers
        }
      }
    }

    // Either local processing is not preferred, not available, or failed
    // Fall back to cloud providers
    return this.cloudAdapter.sendRequest(request);
  }

  async *streamStructuredRequest(
    request: LLMRequest,
  ): AsyncGenerator<Result<string>> {
    // If local processing is preferred and available, try it first
    if (this.preferLocal) {
      const localAvailable = await this.isLocalLLMAvailable();

      if (localAvailable && this.config.webLlmAdapter) {
        try {
          // Attempt to stream from local LLM
          let hasError = false;

          for await (const result of this.config.webLlmAdapter.streamStructuredRequest(
            request,
          )) {
            // Forward the result
            yield result;

            // If any chunk has an error, we'll need to fall back to cloud
            if (!result.success) {
              hasError = true;
              break;
            }
          }

          // If we completed streaming without errors, we're done
          if (!hasError) return;

          // Otherwise, we'll fall back to cloud processing
        } catch {
          // Local processing error, fall back to cloud
          // We continue to the next section to use cloud providers
        }
      }
    }

    // Either local processing is not preferred, not available, or failed
    // Fall back to cloud providers
    yield* this.cloudAdapter.streamStructuredRequest(request);
  }
}
