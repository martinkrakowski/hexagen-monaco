import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";
import type { RefinementEngineSelectorPort } from "../../application/ports/refinement-engine-selector.port.js";
import type { CloudProviderHealthPort } from "../../application/ports/cloud-provider-health.port.js";
import type { TandemConfigPersistencePort } from "../../application/ports/tandem-config-persistence.port.js";
import type {
  RefinementEngine,
  RefinementEngineOption,
} from "../../domain/index.js";
import {
  filterValidEngines,
  sortEngines,
  mapToOptions,
  resolveDefaultEngine,
} from "../../domain/index.js";

export class RefinementEngineSelectorAdapter implements RefinementEngineSelectorPort {
  constructor(
    private readonly healthPort: CloudProviderHealthPort,
    private readonly persistencePort: TandemConfigPersistencePort,
  ) {}

  /**
   * Queries available cloud providers and returns an ordered list of valid/degraded refinement engine options.
   * Filters out UNAVAILABLE or UNVALIDATED engines.
   * Returns empty list if no providers are valid/degraded.
   * Sorted BYOK first, then ENV.
   */
  async getSelectableEngines(): Promise<Result<RefinementEngineOption[]>> {
    try {
      const healthResult = await this.healthPort.getProvidersHealth();
      if (!healthResult.success) {
        return err(healthResult.error);
      }

      const validEngines = filterValidEngines(healthResult.value);
      const sortedEngines = sortEngines(validEngines);
      const options = mapToOptions(sortedEngines);
      return ok(options);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Resolves and returns the active refinement engine (accounting for user overrides and priority).
   * Returns null if no active engine can be resolved.
   */
  async getActiveEngine(): Promise<Result<RefinementEngine | null>> {
    try {
      const healthResult = await this.healthPort.getProvidersHealth();
      if (!healthResult.success) {
        return err(healthResult.error);
      }

      const configResult = this.persistencePort.read();
      if (!configResult.success) {
        return err(configResult.error);
      }

      const selection = configResult.value.refinementEngine;
      const validEngines = filterValidEngines(healthResult.value);

      if (validEngines.length === 0) {
        return ok(null);
      }

      // If user selected "ENV" (the default option), apply default priority (BYOK > ENV when both are valid)
      if (selection === "ENV") {
        return ok(resolveDefaultEngine(validEngines));
      }

      // If user explicitly selected "BYOK", restrict only to BYOK engines
      if (selection === "BYOK") {
        const byokEngines = validEngines.filter((e) => e.type === "BYOK");
        if (byokEngines.length > 0) {
          return ok(resolveDefaultEngine(byokEngines));
        }
        return ok(null);
      }

      // If the selection is a specific engine ID, it must exist in validEngines
      if (selection) {
        const specificEngine = validEngines.find((e) => e.id === selection);
        if (specificEngine) {
          return ok(specificEngine);
        }
        return ok(null);
      }

      return ok(resolveDefaultEngine(validEngines));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Persists a user override selection for the refinement engine.
   * Writes selection to config under namespaced key 'hexagen:tandem:config'
   */
  async selectEngine(engineId: string): Promise<Result<void>> {
    try {
      const configResult = this.persistencePort.read();
      if (!configResult.success) {
        return err(configResult.error);
      }

      const updatedConfig = {
        ...configResult.value,
        refinementEngine: engineId,
      };

      const writeResult = this.persistencePort.write(updatedConfig);
      if (!writeResult.success) {
        return err(writeResult.error);
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
