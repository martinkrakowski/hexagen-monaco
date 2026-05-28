import type { Result } from "@hexagen/shared";
import type {
  RefinementEngine,
  RefinementEngineOption,
} from "../../domain/index.js";

export interface RefinementEngineSelectorPort {
  /**
   * Queries available cloud providers and returns an ordered list of valid/degraded refinement engine options.
   * Filters out UNAVAILABLE or UNVALIDATED engines.
   * Returns empty list if no providers are valid/degraded.
   * Sorted BYOK first, then ENV.
   */
  getSelectableEngines(): Promise<Result<RefinementEngineOption[]>>;

  /**
   * Resolves and returns the active refinement engine (accounting for user overrides and priority).
   * Returns null if no active engine can be resolved.
   */
  getActiveEngine(): Promise<Result<RefinementEngine | null>>;

  /**
   * Persists a user override selection for the refinement engine.
   * Writes selection to config under namespaced key 'hexagen:tandem:config'
   */
  selectEngine(engineId: string): Promise<Result<void>>;
}
