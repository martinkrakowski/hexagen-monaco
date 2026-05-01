import type { Result } from "@hexagen/shared";
import type { DomainModelId } from "../../../lib/llm-interfaces";

/**
 * Storage keys for model preferences - synchronized with the LocalLLM context
 * to ensure consistent usage across the application
 */
export const STORAGE_KEYS = {
  // The model ID that was last used
  LAST_MODEL_ID: "hexagen:local-llm:last-model",

  // Whether to auto-load the model on app startup
  AUTO_LOAD_ENABLED: "hexagen:local-llm:auto-load",

  // Whether the user has previously enabled local model execution
  HAS_ENABLED_LOCAL_MODELS: "hexagen:local-llm:has-enabled",

  // User cloud provider preferences
  CLOUD_PROVIDER: "hexagen:manifest-flow:cloud-provider",

  // Whether to remember the API key (actual API keys are stored in SecretVault)
  REMEMBER_API_KEY: "hexagen:manifest-flow:remember-api-key",

  // Unique key for identifying stored API keys in the SecretVault
  API_KEY_VAULT_ID: "manifest-gen-api-key",

  // Whether to skip AI setup and use templates only
  SKIP_AI_SETUP: "hexagen:manifest-flow:skip-ai-setup",

  // Whether to remember model choice across sessions
  REMEMBER_CHOICE: "hexagen:manifest-flow:remember-choice",

  // Prefix for model cache metadata
  MODEL_CACHE_METADATA_PREFIX: "hexagen:local-llm:cache-metadata:",
};

export interface ModelPreferences {
  // Whether the user has ever successfully enabled local model execution
  hasEnabledLocalModels: boolean;

  // The last model ID that was successfully used
  lastModelId: DomainModelId | null;

  // Whether to automatically load the model on startup
  autoLoadEnabled: boolean;

  // User's preferred cloud provider, if any
  cloudProvider: string | null;

  // Whether to remember the API key
  rememberApiKey: boolean;

  // Whether to skip AI entirely
  skipAiSetup: boolean;

  // Whether to remember model selection across sessions
  rememberChoice: boolean;
}

/**
 * Model cache metadata to track verification status
 */
export interface ModelCacheMetadata {
  // When the model was last verified as working
  verifiedAt: number | null;

  // Whether download completed successfully
  downloadCompleted: boolean;
}

/**
 * Get cached model metadata
 */
export function getModelCacheMetadata(modelId: string): ModelCacheMetadata {
  if (typeof localStorage === "undefined") {
    return {
      verifiedAt: null,
      downloadCompleted: false,
    };
  }

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const stored = localStorage.getItem(key);

  if (!stored) {
    return {
      verifiedAt: null,
      downloadCompleted: false,
    };
  }

  try {
    return JSON.parse(stored) as ModelCacheMetadata;
  } catch {
    return {
      verifiedAt: null,
      downloadCompleted: false,
    };
  }
}

/**
 * Update model cache metadata
 */
export function updateModelCacheMetadata(
  modelId: string,
  updates: Partial<ModelCacheMetadata>,
): void {
  if (typeof localStorage === "undefined") return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  const current = getModelCacheMetadata(modelId);
  const updated = { ...current, ...updates };

  localStorage.setItem(key, JSON.stringify(updated));
}

/**
 * Clear model cache metadata for specified model ID
 */
export function clearModelCacheMetadata(modelId: string): void {
  if (typeof localStorage === "undefined") return;

  const key = `${STORAGE_KEYS.MODEL_CACHE_METADATA_PREFIX}${modelId}`;
  localStorage.removeItem(key);
}

/**
 * Checks if model has been verified in the specified time frame (in hours)
 */
export function isModelVerified(
  modelId: string,
  maxAgeBefore: number = 24,
): boolean {
  const metadata = getModelCacheMetadata(modelId);

  // If never verified, return false
  if (metadata.verifiedAt === null) {
    return false;
  }

  // Check if verification is older than maxAgeBefore hours
  const nowMs = Date.now();
  const maxAgeMs = maxAgeBefore * 60 * 60 * 1000; // Convert hours to milliseconds
  const ageMs = nowMs - metadata.verifiedAt;

  return ageMs < maxAgeMs;
}

/**
 * Get all model preferences from storage
 */
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

/**
 * Save model preferences to storage
 */
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

/**
 * Clear all model preferences from storage
 */
export function clearModelPreferences(): void {
  if (typeof localStorage === "undefined") return;

  localStorage.removeItem(STORAGE_KEYS.LAST_MODEL_ID);
  localStorage.removeItem(STORAGE_KEYS.AUTO_LOAD_ENABLED);
  localStorage.removeItem(STORAGE_KEYS.CLOUD_PROVIDER);
  localStorage.removeItem(STORAGE_KEYS.REMEMBER_API_KEY);
  localStorage.removeItem(STORAGE_KEYS.SKIP_AI_SETUP);
  localStorage.removeItem(STORAGE_KEYS.REMEMBER_CHOICE);
  // Note: We don't clear HAS_ENABLED_LOCAL_MODELS as it's a persistent flag
}

/**
 * API key handling functions that work with the SecretVault
 */
export interface ApiKeyManager {
  /**
   * Save API key to the secret vault if remember is true
   */
  saveApiKey: (
    provider: string,
    key: string,
    remember: boolean,
  ) => Promise<void>;

  /**
   * Get the API key for a provider from the secret vault
   */
  getApiKey: (provider: string) => Promise<string | null>;

  /**
   * Clear saved API keys from the secret vault
   */
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
      await secretVault.destroy().catch(() => {
        // Ignore errors
      });

      saveModelPreferences({ rememberApiKey: false });
    },
  };
}
