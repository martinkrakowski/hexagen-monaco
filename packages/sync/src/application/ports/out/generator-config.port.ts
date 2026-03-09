import type { Result } from '@hexagen/shared'; // adjust if Result is elsewhere

export type InvariantPriority = 'critical' | 'high' | 'medium';
export type FailureMode = 'abort' | 'abort-and-cleanup' | 'warn-and-continue';

export interface InvariantConfig {
  name: string;
  description: string;
  priority: InvariantPriority;
  enforcement?: 'bootstrap' | 'generation-time';
  failure: FailureMode;
}

export interface BootstrapStep {
  name: string;
  priority: InvariantPriority;
  failure: FailureMode;
  note?: string;
}

export interface GeneratorConfigPort {
  /**
   * Get the full ordered bootstrap sequence.
   */
  getBootstrapSequence(): Promise<Result<BootstrapStep[], Error>>;

  /**
   * Get the failure behavior for a given priority level.
   */
  getFailureBehavior(priority: InvariantPriority): Promise<FailureMode>;

  /**
   * Get the config for a specific invariant by name.
   */
  getInvariantPriority(
    invariantName: string
  ): Promise<InvariantPriority | null>;

  /**
   * Get all invariants with their configs.
   */
  getAllInvariants(): Promise<Result<InvariantConfig[], Error>>;
}
