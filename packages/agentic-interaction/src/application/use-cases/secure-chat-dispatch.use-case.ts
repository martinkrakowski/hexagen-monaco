import { err } from "@hexagen/shared";
import type { Result } from "@hexagen/shared";
import type {
  CloudLLMProviderPort,
  CloudLLMCompletionRequest,
  CloudLLMCompletionResponse,
} from "../../domain/ports/cloud-llm-provider.port.js";
import type { SecretVaultPort } from "../ports/index.js";
import type { VaultError } from "../../domain/index.js";

/**
 * Use case that orchestrates secure cloud chat dispatch.
 *
 * Retrieves the plaintext API key from the vault and injects it into the
 * cloud LLM request before dispatch. This ensures the key is only retrieved
 * from storage at the moment it's needed.
 */
export class SecureChatDispatchUseCase {
  constructor(
    private readonly vaultPort: SecretVaultPort,
    private readonly cloudLLMProvider: CloudLLMProviderPort,
  ) {}

  /**
   * Execute a secure chat dispatch.
   *
   * @param request The base chat request (without API key)
   * @returns Result containing the cloud LLM response or a vault error
   */
  async execute(
    request: Omit<CloudLLMCompletionRequest, "apiKey">,
  ): Promise<Result<CloudLLMCompletionResponse, VaultError>> {
    // Retrieve the API key from the vault
    const keyResult = await this.vaultPort.retrieve();
    if (!keyResult.success) {
      return err(keyResult.error);
    }

    const apiKey = keyResult.value;

    // Inject the key into the request and dispatch
    const fullRequest: CloudLLMCompletionRequest = {
      ...request,
      apiKey,
    };

    const response = await this.cloudLLMProvider.complete(fullRequest);

    if (!response.success) {
      // Cloud LLM provider errors are not VaultError, but we must return VaultError per contract.
      // This is a limitation: we lose the original error details.
      // Future: Consider a wider error union or error translation layer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        success: false,
        error: {
          kind: "storage_unavailable" as const,
          message: "Cloud LLM provider request failed",
        },
      } as Result<CloudLLMCompletionResponse, VaultError>;
    }

    // Type cast needed: response.value may not match CloudLLMCompletionResponse exactly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
      success: true,
      value: response.value as CloudLLMCompletionResponse,
    } as Result<CloudLLMCompletionResponse, VaultError>;
  }

  /**
   * Stream a secure chat dispatch.
   *
   * @param request The base chat request (without API key)
   * @returns AsyncGenerator of Result<string> or an error result on vault failure
   */
  async *streamExecute(
    request: Omit<CloudLLMCompletionRequest, "apiKey">,
  ): AsyncGenerator<Result<string, VaultError>> {
    // Retrieve the API key from the vault
    const keyResult = await this.vaultPort.retrieve();
    if (!keyResult.success) {
      yield err(keyResult.error);
      return;
    }

    const apiKey = keyResult.value;

    // Inject the key into the request and stream
    const fullRequest: CloudLLMCompletionRequest = {
      ...request,
      apiKey,
    };

    for await (const chunk of this.cloudLLMProvider.streamComplete(
      fullRequest,
    )) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yield chunk as any;
    }
  }
}
