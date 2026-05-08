import { MODEL_PREFERENCE_KEYS } from "./model-preference-keys.js";

export interface ModelPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isBrowser: boolean = (() => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    );
  } catch {
    return false;
  }
})();

function getStorage(): ModelPreferencesStorage | null {
  if (!isBrowser) return null;
  return window.localStorage;
}

export function getAutoLoadEnabled(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED) === "true";
}

export function getHasEnabledLocalModels(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return (
    storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS) !== null
  );
}

export function getHasEnabledLocalModelsFlag(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return (
    storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS) === "true"
  );
}

export function removeEnginePreferenceKeys(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED);
  storage.removeItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID);
}

export function saveEngineInitSuccess(modelId: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "true");
  storage.setItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID, modelId);
  if (
    storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS) !== "true"
  ) {
    storage.setItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
  }
}

export function backfillHasEnabledForMigration(): void {
  const storage = getStorage();
  if (!storage) return;
  if (
    storage.getItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED) === "true" &&
    storage.getItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS) === null
  ) {
    storage.setItem(MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
  }
}

export function resetLocalAIConfig(): string[] {
  const storage = getStorage();
  if (!storage) return [];

  const clearedKeys: string[] = [];

  const directKeys = [
    MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS,
    MODEL_PREFERENCE_KEYS.LAST_MODEL_ID,
    MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED,
    "hexagen:model-verification-cache",
  ];

  for (const key of directKeys) {
    if (storage.getItem(key) !== null) {
      storage.removeItem(key);
      clearedKeys.push(key);
    }
  }

  if (
    "length" in storage &&
    typeof (storage as Record<string, unknown>).key === "function"
  ) {
    const ls = storage as unknown as Storage;
    const prefix = MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX;
    const keysToClear: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key && key.startsWith(prefix)) {
        keysToClear.push(key);
      }
    }
    for (const key of keysToClear) {
      storage.removeItem(key);
      clearedKeys.push(key);
    }
  }

  return clearedKeys;
}
