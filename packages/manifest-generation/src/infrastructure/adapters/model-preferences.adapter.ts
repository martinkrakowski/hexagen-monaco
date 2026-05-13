import type { DomainModelId } from "@hexagen/local-llm/client";
import { MODEL_PREFERENCE_KEYS } from "@hexagen/shared";
import type { ModelPreferencesPort } from "../../application/ports/out/model-preferences.port";
import type { ModelVerificationPort } from "../../application/ports/out/model-verification.port";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEYS = MODEL_PREFERENCE_KEYS;

function getDefaultPreferences() {
  return {
    hasEnabledLocalModels: false,
    lastModelId: null,
    autoLoadEnabled: false,
    cloudProvider: null,
    rememberApiKey: false,
    skipAiSetup: false,
    rememberChoice: false,
  };
}

export function createModelPreferencesAdapter(
  storage: StorageLike,
): ModelPreferencesPort {
  return {
    getPreferences(): {
      hasEnabledLocalModels: boolean;
      lastModelId: DomainModelId | null;
      autoLoadEnabled: boolean;
      cloudProvider: string | null;
      rememberApiKey: boolean;
      skipAiSetup: boolean;
      rememberChoice: boolean;
    } {
      return {
        hasEnabledLocalModels:
          storage.getItem(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS) === "true",
        lastModelId: storage.getItem(
          STORAGE_KEYS.LAST_MODEL_ID,
        ) as DomainModelId | null,
        autoLoadEnabled:
          storage.getItem(STORAGE_KEYS.AUTO_LOAD_ENABLED) === "true",
        cloudProvider: storage.getItem(STORAGE_KEYS.CLOUD_PROVIDER),
        rememberApiKey:
          storage.getItem(STORAGE_KEYS.REMEMBER_API_KEY) === "true",
        skipAiSetup: storage.getItem(STORAGE_KEYS.SKIP_AI_SETUP) === "true",
        rememberChoice:
          storage.getItem(STORAGE_KEYS.REMEMBER_CHOICE) === "true",
      };
    },

    setPreferences(
      preferences: Partial<{
        hasEnabledLocalModels: boolean;
        lastModelId: DomainModelId | null;
        autoLoadEnabled: boolean;
        cloudProvider: string | null;
        rememberApiKey: boolean;
        skipAiSetup: boolean;
        rememberChoice: boolean;
      }>,
    ): void {
      if (preferences.hasEnabledLocalModels !== undefined) {
        storage.setItem(
          STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS,
          preferences.hasEnabledLocalModels ? "true" : "false",
        );
      }

      if (preferences.lastModelId !== undefined) {
        if (preferences.lastModelId) {
          storage.setItem(STORAGE_KEYS.LAST_MODEL_ID, preferences.lastModelId);
        } else {
          storage.removeItem(STORAGE_KEYS.LAST_MODEL_ID);
        }
      }

      if (preferences.autoLoadEnabled !== undefined) {
        storage.setItem(
          STORAGE_KEYS.AUTO_LOAD_ENABLED,
          preferences.autoLoadEnabled ? "true" : "false",
        );
      }

      if (preferences.cloudProvider !== undefined) {
        if (preferences.cloudProvider) {
          storage.setItem(
            STORAGE_KEYS.CLOUD_PROVIDER,
            preferences.cloudProvider,
          );
        } else {
          storage.removeItem(STORAGE_KEYS.CLOUD_PROVIDER);
        }
      }

      if (preferences.rememberApiKey !== undefined) {
        storage.setItem(
          STORAGE_KEYS.REMEMBER_API_KEY,
          preferences.rememberApiKey ? "true" : "false",
        );
      }

      if (preferences.skipAiSetup !== undefined) {
        storage.setItem(
          STORAGE_KEYS.SKIP_AI_SETUP,
          preferences.skipAiSetup ? "true" : "false",
        );
      }

      if (preferences.rememberChoice !== undefined) {
        storage.setItem(
          STORAGE_KEYS.REMEMBER_CHOICE,
          preferences.rememberChoice ? "true" : "false",
        );
      }
    },
  };
}

const noopStorage: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function getStorageSafely(): StorageLike | null {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    ) {
      return window.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

export function createLocalStorageModelPreferencesAdapter(): ModelPreferencesPort {
  const storage = getStorageSafely() ?? noopStorage;
  return createModelPreferencesAdapter(storage);
}

interface CacheMetadata {
  verifiedAt: number | null;
  downloadCompleted: boolean;
}

function getCacheMetadata(
  storage: StorageLike,
  modelId: string,
): CacheMetadata {
  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const stored = storage.getItem(key);

  if (!stored) {
    return { verifiedAt: null, downloadCompleted: false };
  }

  try {
    return JSON.parse(stored) as CacheMetadata;
  } catch {
    return { verifiedAt: null, downloadCompleted: false };
  }
}

export function createLocalStorageVerificationAdapter(
  storage: StorageLike,
): ModelVerificationPort {
  return {
    isModelVerified(modelId: DomainModelId, maxAgeHours: number = 24): boolean {
      const metadata = getCacheMetadata(storage, modelId);
      if (metadata.verifiedAt === null) return false;

      const nowMs = Date.now();
      const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
      return nowMs - metadata.verifiedAt < maxAgeMs;
    },

    updateModelCacheMetadata(
      modelId: DomainModelId,
      updates: { verifiedAt?: number; downloadCompleted?: boolean },
    ): void {
      const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
      const current = getCacheMetadata(storage, modelId);
      const updated = { ...current, ...updates };
      storage.setItem(key, JSON.stringify(updated));
    },

    clearModelCacheMetadata(modelId: DomainModelId): void {
      const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
      storage.removeItem(key);
    },
  };
}

export function createBrowserVerificationAdapter(): ModelVerificationPort {
  const storage = getStorageSafely() ?? noopStorage;
  return createLocalStorageVerificationAdapter(storage);
}
