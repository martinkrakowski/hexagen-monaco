import type { Result } from "@hexagen/shared";
import {
  MODEL_PREFERENCE_KEYS,
  getAutoLoadEnabled as _getAutoLoadEnabled,
  getHasEnabledLocalModels as _getHasEnabledLocalModels,
  getHasEnabledLocalModelsFlag as _getHasEnabledLocalModelsFlag,
  removeEnginePreferenceKeys as _removeEnginePreferenceKeys,
  saveEngineInitSuccess as _saveEngineInitSuccess,
  backfillHasEnabledForMigration as _backfillHasEnabledForMigration,
} from "@hexagen/shared";
import type { DomainModelId } from "../../../lib/llm-interfaces";
import { ModelVerificationCacheAdapter } from "@hexagen/web-driver";

export { MODEL_PREFERENCE_KEYS };

export const STORAGE_KEYS = MODEL_PREFERENCE_KEYS;

export const getAutoLoadEnabled = _getAutoLoadEnabled;
export const getHasEnabledLocalModels = _getHasEnabledLocalModels;
export const getHasEnabledLocalModelsFlag = _getHasEnabledLocalModelsFlag;
export const removeEnginePreferenceKeys = _removeEnginePreferenceKeys;
export const saveEngineInitSuccess = _saveEngineInitSuccess;
export const backfillHasEnabledForMigration = _backfillHasEnabledForMigration;

export interface ModelPreferences {
  hasEnabledLocalModels: boolean;
  lastModelId: DomainModelId | null;
  autoLoadEnabled: boolean;
  cloudProvider: string | null;
  rememberApiKey: boolean;
  skipAiSetup: boolean;
  rememberChoice: boolean;
}

export interface ModelCacheMetadata {
  verifiedAt: number | null;
  downloadCompleted: boolean;
}

function getStorage(): Storage | null {
  if (typeof globalThis !== "undefined" && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  return null;
}

export function getModelCacheMetadata(modelId: string): ModelCacheMetadata {
  const storage = getStorage();
  if (!storage) {
    return { verifiedAt: null, downloadCompleted: false };
  }

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const stored = storage.getItem(key);

  if (!stored) {
    return { verifiedAt: null, downloadCompleted: false };
  }

  try {
    return JSON.parse(stored) as ModelCacheMetadata;
  } catch {
    return { verifiedAt: null, downloadCompleted: false };
  }
}

export function updateModelCacheMetadata(
  modelId: string,
  updates: Partial<ModelCacheMetadata>,
): void {
  const storage = getStorage();
  if (!storage) return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const current = getModelCacheMetadata(modelId);
  const updated = { ...current, ...updates };

  storage.setItem(key, JSON.stringify(updated));

  if (updates.verifiedAt !== undefined) {
    const isSuccessfulVerification = updates.downloadCompleted !== false;
    ModelVerificationCacheAdapter.setVerificationResult(
      modelId,
      isSuccessfulVerification,
    );
  }
}

export function clearModelCacheMetadata(modelId: string): void {
  const storage = getStorage();
  if (!storage) return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  storage.removeItem(key);
}

export function isModelVerified(
  modelId: string,
  maxAgeBefore: number = 24,
): boolean {
  const cachedVerification =
    ModelVerificationCacheAdapter.getVerificationResult(modelId);

  if (cachedVerification !== null) {
    return cachedVerification;
  }

  const metadata = getModelCacheMetadata(modelId);

  if (metadata.verifiedAt === null) {
    return false;
  }

  const nowMs = Date.now();
  const maxAgeMs = maxAgeBefore * 60 * 60 * 1000;
  const ageMs = nowMs - metadata.verifiedAt;

  return ageMs < maxAgeMs;
}

export function getModelPreferences(): ModelPreferences {
  const storage = getStorage();
  if (!storage) {
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

  return {
    hasEnabledLocalModels:
      storage.getItem(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS) === "true",
    lastModelId: storage.getItem(
      STORAGE_KEYS.LAST_MODEL_ID,
    ) as DomainModelId | null,
    autoLoadEnabled: storage.getItem(STORAGE_KEYS.AUTO_LOAD_ENABLED) === "true",
    cloudProvider: storage.getItem(STORAGE_KEYS.CLOUD_PROVIDER),
    rememberApiKey: storage.getItem(STORAGE_KEYS.REMEMBER_API_KEY) === "true",
    skipAiSetup: storage.getItem(STORAGE_KEYS.SKIP_AI_SETUP) === "true",
    rememberChoice: storage.getItem(STORAGE_KEYS.REMEMBER_CHOICE) === "true",
  };
}

export function saveModelPreferences(
  preferences: Partial<ModelPreferences>,
): void {
  const storage = getStorage();
  if (!storage) return;

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
      storage.setItem(STORAGE_KEYS.CLOUD_PROVIDER, preferences.cloudProvider);
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
}

export function clearModelPreferences(): void {
  const storage = getStorage();
  if (!storage) return;

  storage.removeItem(STORAGE_KEYS.LAST_MODEL_ID);
  storage.removeItem(STORAGE_KEYS.AUTO_LOAD_ENABLED);
  storage.removeItem(STORAGE_KEYS.CLOUD_PROVIDER);
  storage.removeItem(STORAGE_KEYS.REMEMBER_API_KEY);
  storage.removeItem(STORAGE_KEYS.SKIP_AI_SETUP);
  storage.removeItem(STORAGE_KEYS.REMEMBER_CHOICE);
}

export interface ApiKeyManager {
  saveApiKey: (
    provider: string,
    key: string,
    remember: boolean,
  ) => Promise<void>;
  getApiKey: (provider: string) => Promise<string | null>;
  clearApiKeys: () => Promise<void>;
}

export async function createApiKeyManager(secretVault: {
  store: (
    apiKey: string,
    persistOrPassword?: boolean | string,
  ) => Promise<Result<void, unknown>>;
  retrieve: () => Promise<Result<string, unknown>>;
  destroy: () => Promise<Result<void, unknown>>;
}): Promise<ApiKeyManager> {
  return {
    saveApiKey: async (provider: string, key: string, remember: boolean) => {
      if (remember && key) {
        await secretVault.store(key, true);
        saveModelPreferences({
          cloudProvider: provider,
          rememberApiKey: true,
        });
      }
    },

    getApiKey: async () => {
      const prefs = getModelPreferences();
      if (!prefs.rememberApiKey) return null;

      const result = await secretVault.retrieve();
      return result.success ? result.value : null;
    },

    clearApiKeys: async () => {
      await secretVault.destroy().catch(() => {});
      saveModelPreferences({ rememberApiKey: false });
    },
  };
}
