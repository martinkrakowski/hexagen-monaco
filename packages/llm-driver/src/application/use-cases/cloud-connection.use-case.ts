import type { Result } from "@hexagen/shared";
import type { CloudKeyRetrievalPort } from "../ports/out/cloud-key-retrieval.port.js";
import {
  CloudConnectionMachineState,
  ConnectionError,
  createInitialMachineState,
  transitionToConnecting,
  transitionToConnected,
  transitionToError,
  transitionToIdle,
  shouldRetry,
  getNextRetryCount,
  calculateRetryDelay,
  MAX_RETRY_ATTEMPTS,
  CONNECTION_TIMEOUT_MS,
} from "../../domain/services/cloud-connection-state-machine.js";

export interface CloudLLMConfig {
  provider: string;
  model: string;
}

export interface CloudConnectionResult {
  success: boolean;
  config: CloudLLMConfig | null;
  error: ConnectionError | null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs),
    ),
  ]);
}

export interface CloudConnectionUseCaseDependencies {
  vault: CloudKeyRetrievalPort;
}

export interface CloudConnectionUseCase {
  (config: CloudLLMConfig, retryCount?: number): Promise<CloudConnectionResult>;
}

export function createCloudConnectionUseCase(
  deps: CloudConnectionUseCaseDependencies,
): CloudConnectionUseCase {
  return async (
    config: CloudLLMConfig,
    retryCount = 0,
  ): Promise<CloudConnectionResult> => {
    let state: CloudConnectionMachineState = createInitialMachineState();

    state = transitionToConnecting();

    try {
      const vaultResult = await withTimeout(
        deps.vault.retrieve(),
        CONNECTION_TIMEOUT_MS,
        "Connection timeout: Vault operation took too long. Please try again.",
      );

      if (!vaultResult.success) {
        const errorMessage =
          vaultResult.error?.message ??
          "Failed to retrieve API key from vault. Please check your credentials.";
        state = transitionToError(state, errorMessage, retryCount);
        return {
          success: false,
          config: null,
          error: state.error,
        };
      }

      state = transitionToConnected();
      return {
        success: true,
        config,
        error: null,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state = transitionToError(state, errorMessage, retryCount);

      return {
        success: false,
        config: null,
        error: state.error,
      };
    }
  };
}

/**
 * Wait `delay` ms, then run `recurse` and adopt its result.
 *
 * The delay Promise wraps ONLY the timer, which cannot throw, and `recurse`
 * runs after the `await` inside this async function — so a synchronous throw
 * from `recurse` (e.g. constructing the next use-case) becomes a rejection of
 * the returned Promise instead of stranding it.
 *
 * The previous inline form was:
 *
 *   return new Promise((resolve) => {
 *     setTimeout(() => { resolve(recurse()); }, delay);
 *   });
 *
 * which has no reject path: a synchronous throw while evaluating `recurse()`
 * inside the `setTimeout` callback is an unhandled exception, `resolve` is
 * never called, and the returned Promise stays pending forever (hang).
 *
 * Exported for the retry-semantics suite; not part of the package's public port
 * surface.
 */
export async function scheduleRetry<T>(
  delay: number,
  recurse: () => Promise<T>,
): Promise<T> {
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  return recurse();
}

export function createCloudConnectionUseCaseWithRetry(
  deps: CloudConnectionUseCaseDependencies,
  onResult?: (result: CloudConnectionResult) => void,
): CloudConnectionUseCase {
  const useCase = createCloudConnectionUseCase(deps);

  return async (
    config: CloudLLMConfig,
    retryCount = 0,
  ): Promise<CloudConnectionResult> => {
    const result = await useCase(config, retryCount);
    onResult?.(result);

    if (!result.success && result.error && shouldRetry(result.error)) {
      const nextRetryCount = getNextRetryCount(result.error);
      const delay = calculateRetryDelay(retryCount);

      // Recursion is bounded by MAX_RETRY_ATTEMPTS: transitionToError sets
      // `retryable: retryCount < MAX_RETRY_ATTEMPTS`, so shouldRetry stops the
      // chain once nextRetryCount reaches the cap.
      return scheduleRetry(delay, () =>
        createCloudConnectionUseCaseWithRetry(deps, onResult)(
          config,
          nextRetryCount,
        ),
      );
    }

    return result;
  };
}
