/**
 * AgentCore Memory configuration, resolved from install answers + environment.
 *
 * `{memory_mode}` and `{memory_strategies}` are interpolated at scaffold time
 * (a multiselect renders as a comma-joined string), while the resource id comes
 * from the environment after provisioning.
 */
export type MemoryStrategy = "SEMANTIC" | "SUMMARY" | "USER_PREFERENCE";
export type MemoryRetention = "shortTerm" | "longAndShortTerm";

export interface MemoryConfig {
  readonly memoryId: string;
  readonly namespace: string;
  readonly retention: MemoryRetention;
  readonly strategies: MemoryStrategy[];
}

const RETENTION = "{memory_mode}" as MemoryRetention;

// Multiselect answers interpolate to a comma-joined string, e.g. "SEMANTIC,SUMMARY".
const CONFIGURED_STRATEGIES = "{memory_strategies}"
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as MemoryStrategy[];

/**
 * Build the runtime memory config. Fails fast (a config error) if the resource
 * id is missing — provision Memory and copy AGENTCORE_MEMORY_ID into .env first.
 */
export function loadMemoryConfig(): MemoryConfig {
  const memoryId = process.env.AGENTCORE_MEMORY_ID;
  if (!memoryId) {
    throw new Error(
      "AGENTCORE_MEMORY_ID is not set — run `agentcore add memory` then copy the id from " +
        "`agentcore status` into .env.local.",
    );
  }
  return {
    memoryId,
    namespace: process.env.AGENTCORE_MEMORY_NAMESPACE ?? "default",
    retention: RETENTION,
    // Short-term-only retention runs no long-term strategies.
    strategies: RETENTION === "shortTerm" ? [] : CONFIGURED_STRATEGIES,
  };
}
