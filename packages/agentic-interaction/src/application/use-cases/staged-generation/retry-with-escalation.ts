export interface EscalationConfig {
  maxDefaultRetries: number;
  maxEscalatedRetries: number;
  escalationModel?: string;
}

export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  maxDefaultRetries: 3,
  maxEscalatedRetries: 3,
  escalationModel: undefined,
};

/**
 * Default escalation config for Stage 3 (Port Mapping).
 *
 * `maxDefaultRetries`/`maxEscalatedRetries` are 1 — this wrapper is ESCALATION-
 * ONLY, not a retry budget. Stage 3's own per-call loop (`runSingleAttempt`,
 * MAX_RETRY_ATTEMPTS) already retries the SAME model with a smart retry-prompt
 * that feeds the failed output back. So the wrapper calls the default model once
 * (one full inner loop) and, only if that still yields nothing AND an
 * escalationModel is wired, the escalation model once (another full inner loop).
 * Setting these >1 re-runs the entire inner loop per outer attempt — e.g. 3×3 = 9
 * same-model calls for a single context, with the exhaustion banner logged 3×.
 *
 * `escalationModel` is intentionally undefined here — the wiring layer should
 * inject a model name only when it knows the configured provider supports it.
 * Hardcoding "gpt-4o" here breaks any non-OpenAI provider (NVIDIA, vLLM,
 * Ollama, Anthropic, etc.) with 404s during escalation.
 */
export const STAGE3_ESCALATION_CONFIG: EscalationConfig = {
  maxDefaultRetries: 1,
  maxEscalatedRetries: 1,
  escalationModel: undefined,
};

export async function retryWithEscalation<T>(
  fn: (preferredCloudModel?: string) => Promise<T>,
  config: EscalationConfig,
  shouldRetry: (result: T) => boolean,
): Promise<{ result: T; escalated: boolean; retryCount: number }> {
  if (
    config.maxDefaultRetries <= 0 &&
    (!config.escalationModel || config.maxEscalatedRetries <= 0)
  ) {
    throw new Error("Invalid EscalationConfig: no retry attempts configured");
  }

  let lastResult: T | undefined;
  let retryCount = 0;
  let ranEscalatedAttempt = false;

  for (let attempt = 1; attempt <= config.maxDefaultRetries; attempt++) {
    retryCount = attempt - 1;
    lastResult = await fn(undefined);
    if (!shouldRetry(lastResult)) {
      return { result: lastResult, escalated: false, retryCount };
    }
  }

  if (!config.escalationModel) {
    if (lastResult === undefined) {
      throw new Error("Invalid EscalationConfig: no retry attempts configured");
    }
    return { result: lastResult, escalated: false, retryCount };
  }

  for (let attempt = 1; attempt <= config.maxEscalatedRetries; attempt++) {
    ranEscalatedAttempt = true;
    retryCount = config.maxDefaultRetries + attempt - 1;
    lastResult = await fn(config.escalationModel);
    if (!shouldRetry(lastResult)) {
      return { result: lastResult, escalated: true, retryCount };
    }
  }

  if (lastResult === undefined) {
    throw new Error("Invalid EscalationConfig: no retry attempts configured");
  }

  return { result: lastResult, escalated: ranEscalatedAttempt, retryCount };
}
