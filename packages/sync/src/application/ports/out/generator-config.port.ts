import type { Result } from '@hexagen/sync/domain';

/**
 * The priority level for an invariant.
 */
export type InvariantPriority = 'critical' | 'high' | 'medium';

/**
 * How the system should behave when an invariant fails.
 */
export type FailureMode = 'abort' | 'abort-and-cleanup' | 'warn-and-continue';

/**
 * Configuration for a single invariant.
 */
export interface InvariantConfig {
  /** Human‑readable name of the invariant. */
  name: string;
  /** Description of the invariant's purpose. */
  description: string;
  /** Importance of the invariant. */
  priority: InvariantPriority;
  /** When the invariant is enforced. */
  enforcement?: 'bootstrap' | 'generation-time';
  /** Failure handling strategy. */
  failure: FailureMode;
}

/**
 * A step to be executed during the bootstrap phase.
 */
export interface BootstrapStep {
  /** Step identifier. */
  name: string;
  /** Priority of the step's invariant. */
  priority: InvariantPriority;
  /** Failure handling for this step. */
  failure: FailureMode;
  /** Optional human notes. */
  note?: string;
}

/**
 * Port for reading generator configuration.
 */
export interface GeneratorConfigPort {
  /** Get the full ordered bootstrap sequence. */
  getBootstrapSequence(): Promise<Result<BootstrapStep[], Error>>;

  /** Get the failure behavior for a given priority level. */
  getFailureBehavior(priority: InvariantPriority): Promise<FailureMode>;

  /** Get the configured priority for a named invariant. */
  getInvariantPriority(invariantName: string): Promise<InvariantPriority | null>;

  /** Get all invariants with their configurations. */
  getAllInvariants(): Promise<Result<InvariantConfig[], Error>>;
}
