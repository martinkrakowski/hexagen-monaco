import type { Result } from "@hexagen/shared";
import { ok } from "@hexagen/shared";
import type {
  GeneratorConfigPort,
  BootstrapStep,
  InvariantConfig,
  InvariantPriority,
  FailureMode,
} from "@hexagen/sync";

/**
 * In‑memory fake for `GeneratorConfigPort` used in unit tests.
 * Allows tests to set custom data for bootstrap sequence, invariants,
 * and failure behaviours. If no data is set, sensible defaults are returned.
 */
export class FakeGeneratorConfigPort implements GeneratorConfigPort {
  private bootstrapSequence: BootstrapStep[] = [];
  private invariants: InvariantConfig[] = [];
  private failureMap: Record<InvariantPriority, FailureMode> = {
    critical: "abort-and-cleanup",
    high: "abort",
    medium: "warn-and-continue",
  };

  /** Set a custom bootstrap sequence for the test. */
  setBootstrapSequence(seq: BootstrapStep[]) {
    this.bootstrapSequence = seq;
  }

  /** Set custom invariants for the test. */
  setInvariants(invariants: InvariantConfig[]) {
    this.invariants = invariants;
  }

  /** Override failure mode for a specific priority. */
  setFailureMode(priority: InvariantPriority, mode: FailureMode) {
    this.failureMap[priority] = mode;
  }

  async getBootstrapSequence(): Promise<Result<BootstrapStep[], Error>> {
    return ok(this.bootstrapSequence) as Result<BootstrapStep[], Error>;
  }

  async getFailureBehavior(priority: InvariantPriority): Promise<FailureMode> {
    return this.failureMap[priority];
  }

  async getInvariantPriority(
    invariantName: string,
  ): Promise<InvariantPriority | null> {
    const found = this.invariants.find((i) => i.name === invariantName);
    return found ? found.priority : null;
  }

  async getAllInvariants(): Promise<Result<InvariantConfig[], Error>> {
    return ok(this.invariants) as Result<InvariantConfig[], Error>;
  }
}
