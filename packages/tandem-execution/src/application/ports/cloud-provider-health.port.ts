import type { Result } from "@hexagen/shared";
import type { RefinementEngine } from "../../domain/index.js";

export interface CloudProviderHealthPort {
  /**
   * Queries all available cloud providers (ENV and BYOK) and retrieves their health state.
   */
  getProvidersHealth(): Promise<Result<RefinementEngine[]>>;
}
