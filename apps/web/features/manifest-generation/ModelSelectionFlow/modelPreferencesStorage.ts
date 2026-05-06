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

export function getModelCacheMetadata(modelId: string): ModelCacheMetadata {
  if (typeof localStorage === "undefined") {
    return { verifiedAt: null, downloadCompleted: false };
  }

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const stored = localStorage.getItem(key);

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
  if (typeof localStorage === "undefined") return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const current = getModelCacheMetadata(modelId);
  const updated = { ...current, ...updates };

  localStorage.setItem(key, JSON.stringify(updated));

  if (updates.verifiedAt !== undefined) {
    const isSuccessfulVerification = updates.downloadCompleted !== false;
    ModelVerificationCacheAdapter.setVerificationResult(
      modelId,
      isSuccessfulVerification,
    );
  }
}

export function clearModelCacheMetadata(modelId: string): void {
  if (typeof localStorage === "undefined") return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  localStorage.removeItem(key);
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
  if (typeof localStorage === "undefined") {
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
      localStorage.getItem(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS) === "true",
    lastModelId: localStorage.getItem(
      STORAGE_KEYS.LAST_MODEL_ID,
    ) as DomainModelId | null,
    autoLoadEnabled:
      localStorage.getItem(STORAGE_KEYS.AUTO_LOAD_ENABLED) === "true",
    cloudProvider: localStorage.getItem(STORAGE_KEYS.CLOUD_PROVIDER),
    rememberApiKey:
      localStorage.getItem(STORAGE_KEYS.REMEMBER_API_KEY) === "true",
    skipAiSetup: localStorage.getItem(STORAGE_KEYS.SKIP_AI_SETUP) === "true",
    rememberChoice:
      localStorage.getItem(STORAGE_KEYS.REMEMBER_CHOICE) === "true",
  };
}

export function saveModelPreferences(
  preferences: Partial<ModelPreferences>,
): void {
  if (typeof localStorage === "undefined") return;

  if (preferences.hasEnabledLocalModels !== undefined) {
    localStorage.setItem(
      STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS,
      preferences.hasEnabledLocalModels ? "true" : "false",
    );
  }

  if (preferences.lastModelId !== undefined) {
    if (preferences.lastModelId) {
      localStorage.setItem(STORAGE_KEYS.LAST_MODEL_ID, preferences.lastModelId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.LAST_MODEL_ID);
    }
  }

  if (preferences.autoLoadEnabled !== undefined) {
    localStorage.setItem(
      STORAGE_KEYS.AUTO_LOAD_ENABLED,
      preferences.autoLoadEnabled ? "true" : "false",
    );
  }

  if (preferences.cloudProvider !== undefined) {
    if (preferences.cloudProvider) {
      localStorage.setItem(
        STORAGE_KEYS.CLOUD_PROVIDER,
        preferences.cloudProvider,
      );
    } else {
      localStorage.removeItem(STORAGE_KEYS.CLOUD_PROVIDER);
    }
  }

  if (preferences.rememberApiKey !== undefined) {
    localStorage.setItem(
      STORAGE_KEYS.REMEMBER_API_KEY,
      preferences.rememberApiKey ? "true" : "false",
    );
  }

  if (preferences.skipAiSetup !== undefined) {
    localStorage.setItem(
      STORAGE_KEYS.SKIP_AI_SETUP,
      preferences.skipAiSetup ? "true" : "false",
    );
  }

  if (preferences.rememberChoice !== undefined) {
    localStorage.setItem(
      STORAGE_KEYS.REMEMBER_CHOICE,
      preferences.rememberChoice ? "true" : "false",
    );
  }
}

export function clearModelPreferences(): void {
  if (typeof localStorage === "undefined") return;

  localStorage.removeItem(STORAGE_KEYS.LAST_MODEL_ID);
  localStorage.removeItem(STORAGE_KEYS.AUTO_LOAD_ENABLED);
  localStorage.removeItem(STORAGE_KEYS.CLOUD_PROVIDER);
  localStorage.removeItem(STORAGE_KEYS.REMEMBER_API_KEY);
  localStorage.removeItem(STORAGE_KEYS.SKIP_AI_SETUP);
  localStorage.removeItem(STORAGE_KEYS.REMEMBER_CHOICE);
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
