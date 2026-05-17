/**
 * Specialized agent roles for multi-agent supervision pipeline.
 */
export type AgentRole =
  | "ARCHITECT"
  | "SECURITY_AUDITOR"
  | "VALIDATION_SPECIALIST";

export interface AgentContext {
  readonly role: AgentRole;
  readonly systemPrompt: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

/**
 * Factory: create ARCHITECT agent context.
 */
export function createArchitectAgent(): AgentContext {
  return {
    role: "ARCHITECT",
    systemPrompt: `You are a senior software architect specializing in hexagonal architecture.
Your task is to generate the initial manifest from the user's description.
Focus on correct port interfaces and dependency flow.`,
    maxRetries: 2,
    timeoutMs: 30_000,
  };
}

/**
 * Factory: create SECURITY_AUDITOR agent context.
 */
export function createSecurityAuditor(): AgentContext {
  return {
    role: "SECURITY_AUDITOR",
    systemPrompt: `You are a security compliance auditor.
Evaluate the generated manifest against organizational policies.
Check for secret leaks, network isolation violations, and mandatory tagging.
Return a structured compliance report.`,
    maxRetries: 1,
    timeoutMs: 15_000,
  };
}

/**
 * Factory: create VALIDATION_SPECIALIST agent context.
 */
export function createValidationSpecialist(): AgentContext {
  return {
    role: "VALIDATION_SPECIALIST",
    systemPrompt: `You are a validation specialist.
Review the manifest for hallucinated port mappings and incorrect DDD patterns.
Trigger a regeneration if critical issues are found.`,
    maxRetries: 2,
    timeoutMs: 20_000,
  };
}
