import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";
import type { TandemConfig } from "../../domain/index.js";
import { DEFAULT_TANDEM_CONFIG } from "../../domain/index.js";
import type { TandemConfigPersistencePort } from "../../application/ports/tandem-config-persistence.port.js";

const STORAGE_KEY = "hexagen:tandem:config";

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export class LocalStorageTandemConfigAdapter implements TandemConfigPersistencePort {
  /**
   * Reads the tandem configuration from localStorage, performing any migrations.
   */
  read(): Result<TandemConfig> {
    try {
      const storage = getStorage();
      if (!storage) {
        return ok(DEFAULT_TANDEM_CONFIG);
      }

      const item = storage.getItem(STORAGE_KEY);
      if (!item) {
        return ok(DEFAULT_TANDEM_CONFIG);
      }

      const parsed = JSON.parse(item);

      // Migration: Backfill default values for any missing keys (schema evolution)
      const migratedConfig: TandemConfig = {
        enabled:
          typeof parsed.enabled === "boolean"
            ? parsed.enabled
            : DEFAULT_TANDEM_CONFIG.enabled,
        localModelId:
          typeof parsed.localModelId === "string"
            ? parsed.localModelId
            : DEFAULT_TANDEM_CONFIG.localModelId,
        refinementEngine:
          typeof parsed.refinementEngine === "string"
            ? parsed.refinementEngine
            : DEFAULT_TANDEM_CONFIG.refinementEngine,
        displayPreference:
          parsed.displayPreference === "overwrite" ||
          parsed.displayPreference === "append"
            ? parsed.displayPreference
            : DEFAULT_TANDEM_CONFIG.displayPreference,
        stageOneTimeoutSeconds:
          typeof parsed.stageOneTimeoutSeconds === "number" &&
          Number.isFinite(parsed.stageOneTimeoutSeconds) &&
          parsed.stageOneTimeoutSeconds > 0
            ? parsed.stageOneTimeoutSeconds
            : DEFAULT_TANDEM_CONFIG.stageOneTimeoutSeconds,
        memoryHeadroomMB:
          typeof parsed.memoryHeadroomMB === "number" &&
          Number.isFinite(parsed.memoryHeadroomMB) &&
          parsed.memoryHeadroomMB >= 0
            ? parsed.memoryHeadroomMB
            : DEFAULT_TANDEM_CONFIG.memoryHeadroomMB,
        promptTemplateVersion:
          typeof parsed.promptTemplateVersion === "string"
            ? parsed.promptTemplateVersion
            : DEFAULT_TANDEM_CONFIG.promptTemplateVersion,
        firstTimeExperienceDismissed:
          typeof parsed.firstTimeExperienceDismissed === "boolean"
            ? parsed.firstTimeExperienceDismissed
            : DEFAULT_TANDEM_CONFIG.firstTimeExperienceDismissed,
        autoRetryEnabled:
          typeof parsed.autoRetryEnabled === "boolean"
            ? parsed.autoRetryEnabled
            : DEFAULT_TANDEM_CONFIG.autoRetryEnabled,
        lastValidatedAt:
          typeof parsed.lastValidatedAt === "string"
            ? parsed.lastValidatedAt
            : DEFAULT_TANDEM_CONFIG.lastValidatedAt,
      };

      return ok(migratedConfig);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Writes the tandem configuration to localStorage.
   */
  write(config: TandemConfig): Result<void> {
    try {
      const storage = getStorage();
      if (!storage) {
        return err(
          new Error("Storage is not available in the current environment"),
        );
      }

      storage.setItem(STORAGE_KEY, JSON.stringify(config));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Resets the tandem configuration in localStorage.
   */
  reset(): Result<void> {
    try {
      const storage = getStorage();
      if (!storage) {
        return ok(undefined);
      }

      storage.removeItem(STORAGE_KEY);
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
