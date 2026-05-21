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
  let retryCount = 0;
  let escalated = false;

  for (let attempt = 1; attempt <= config.maxDefaultRetries; attempt++) {
    retryCount = attempt - 1;
    const result = await fn(undefined);
    if (!shouldRetry(result)) {
      return { result, escalated: false, retryCount };
    }
  }

  if (config.escalationModel) {
    escalated = true;
    for (let attempt = 1; attempt <= config.maxEscalatedRetries; attempt++) {
      retryCount = config.maxDefaultRetries + attempt - 1;
      const result = await fn(config.escalationModel);
      if (!shouldRetry(result)) {
        return { result, escalated: true, retryCount };
      }
    }
  }

  const finalResult = await fn(escalated ? config.escalationModel : undefined);
  retryCount =
    config.maxDefaultRetries + (escalated ? config.maxEscalatedRetries : 0);
  return { result: finalResult, escalated, retryCount };
}
