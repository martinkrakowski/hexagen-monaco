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

export const STAGE3_ESCALATION_CONFIG: EscalationConfig = {
  maxDefaultRetries: 3,
  maxEscalatedRetries: 3,
  escalationModel: "gpt-4o",
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
