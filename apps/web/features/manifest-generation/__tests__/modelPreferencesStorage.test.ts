import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  STORAGE_KEYS,
  getModelPreferences,
  saveModelPreferences,
  clearModelPreferences,
} from "../ModelSelectionFlow/modelPreferencesStorage";

describe("modelPreferencesStorage", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    store.clear();
  });

  describe("getModelPreferences", () => {
    it("should return defaults when localStorage is empty", () => {
      const prefs = getModelPreferences();
      assert.strictEqual(prefs.hasEnabledLocalModels, false);
      assert.strictEqual(prefs.lastModelId, null);
      assert.strictEqual(prefs.autoLoadEnabled, false);
      assert.strictEqual(prefs.cloudProvider, null);
      assert.strictEqual(prefs.rememberApiKey, false);
      assert.strictEqual(prefs.skipAiSetup, false);
      assert.strictEqual(prefs.rememberChoice, false);
    });

    it("should return defaults when localStorage is undefined", () => {
      Object.defineProperty(globalThis, "localStorage", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      const prefs = getModelPreferences();
      assert.strictEqual(prefs.hasEnabledLocalModels, false);
      assert.strictEqual(prefs.lastModelId, null);
      assert.strictEqual(prefs.autoLoadEnabled, false);
      assert.strictEqual(prefs.cloudProvider, null);
      assert.strictEqual(prefs.rememberApiKey, false);
      assert.strictEqual(prefs.skipAiSetup, false);
      assert.strictEqual(prefs.rememberChoice, false);
    });

    it("should read stored values", () => {
      store.set(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
      store.set(STORAGE_KEYS.LAST_MODEL_ID, "my-model");
      store.set(STORAGE_KEYS.AUTO_LOAD_ENABLED, "true");
      store.set(STORAGE_KEYS.CLOUD_PROVIDER, "openai");
      store.set(STORAGE_KEYS.REMEMBER_API_KEY, "true");
      store.set(STORAGE_KEYS.SKIP_AI_SETUP, "true");
      store.set(STORAGE_KEYS.REMEMBER_CHOICE, "true");

      const prefs = getModelPreferences();
      assert.strictEqual(prefs.hasEnabledLocalModels, true);
      assert.strictEqual(prefs.lastModelId, "my-model");
      assert.strictEqual(prefs.autoLoadEnabled, true);
      assert.strictEqual(prefs.cloudProvider, "openai");
      assert.strictEqual(prefs.rememberApiKey, true);
      assert.strictEqual(prefs.skipAiSetup, true);
      assert.strictEqual(prefs.rememberChoice, true);
    });

    it("should handle boolean values stored as string", () => {
      store.set(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
      store.set(STORAGE_KEYS.AUTO_LOAD_ENABLED, "false");
      const prefs = getModelPreferences();
      assert.strictEqual(prefs.hasEnabledLocalModels, true);
      assert.strictEqual(prefs.autoLoadEnabled, false);
    });
  });

  describe("saveModelPreferences", () => {
    it("should save preferences to localStorage", () => {
      saveModelPreferences({
        hasEnabledLocalModels: true,
        lastModelId: "test-model",
        autoLoadEnabled: true,
        cloudProvider: "anthropic",
        rememberApiKey: false,
        skipAiSetup: false,
        rememberChoice: true,
      });

      assert.strictEqual(
        store.get(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS),
        "true",
      );
      assert.strictEqual(store.get(STORAGE_KEYS.LAST_MODEL_ID), "test-model");
      assert.strictEqual(store.get(STORAGE_KEYS.AUTO_LOAD_ENABLED), "true");
      assert.strictEqual(store.get(STORAGE_KEYS.CLOUD_PROVIDER), "anthropic");
      assert.strictEqual(store.get(STORAGE_KEYS.REMEMBER_API_KEY), "false");
      assert.strictEqual(store.get(STORAGE_KEYS.SKIP_AI_SETUP), "false");
      assert.strictEqual(store.get(STORAGE_KEYS.REMEMBER_CHOICE), "true");
    });

    it("should save partial preferences without affecting other keys", () => {
      store.set(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
      store.set(STORAGE_KEYS.LAST_MODEL_ID, "existing-model");
      store.set(STORAGE_KEYS.AUTO_LOAD_ENABLED, "false");

      saveModelPreferences({ lastModelId: "updated-model" });

      assert.strictEqual(
        store.get(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS),
        "true",
      );
      assert.strictEqual(
        store.get(STORAGE_KEYS.LAST_MODEL_ID),
        "updated-model",
      );
      assert.strictEqual(store.get(STORAGE_KEYS.AUTO_LOAD_ENABLED), "false");
    });

    it("should remove key when lastModelId is set to null", () => {
      store.set(STORAGE_KEYS.LAST_MODEL_ID, "old-model");
      saveModelPreferences({ lastModelId: null });
      assert.strictEqual(store.has(STORAGE_KEYS.LAST_MODEL_ID), false);
    });

    it("should remove key when cloudProvider is set to null", () => {
      store.set(STORAGE_KEYS.CLOUD_PROVIDER, "openai");
      saveModelPreferences({ cloudProvider: null });
      assert.strictEqual(store.has(STORAGE_KEYS.CLOUD_PROVIDER), false);
    });

    it("should be a no-op when localStorage is undefined", () => {
      Object.defineProperty(globalThis, "localStorage", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      assert.doesNotThrow(() => {
        saveModelPreferences({ skipAiSetup: true });
      });
    });
  });

  describe("rememberChoice persistence", () => {
    it("should persist rememberChoice across get/save cycles", () => {
      saveModelPreferences({
        rememberChoice: true,
        lastModelId: "persisted-model",
      });

      const prefs = getModelPreferences();
      assert.strictEqual(prefs.rememberChoice, true);
      assert.strictEqual(prefs.lastModelId, "persisted-model");
    });

    it("should persist rememberChoice = false across get/save cycles", () => {
      saveModelPreferences({ rememberChoice: true });
      saveModelPreferences({ rememberChoice: false });

      const prefs = getModelPreferences();
      assert.strictEqual(prefs.rememberChoice, false);
    });
  });

  describe("clearAiSetupSkipped behavior", () => {
    it("should allow changing skipAiSetup from true to false", () => {
      saveModelPreferences({ skipAiSetup: true });
      assert.strictEqual(getModelPreferences().skipAiSetup, true);

      saveModelPreferences({ skipAiSetup: false });
      assert.strictEqual(getModelPreferences().skipAiSetup, false);
    });
  });

  describe("clearModelPreferences", () => {
    it("should remove all preference keys", () => {
      saveModelPreferences({
        hasEnabledLocalModels: true,
        lastModelId: "sample",
        autoLoadEnabled: true,
        cloudProvider: "openai",
        rememberApiKey: true,
        skipAiSetup: true,
        rememberChoice: true,
      });

      clearModelPreferences();

      assert.strictEqual(store.has(STORAGE_KEYS.LAST_MODEL_ID), false);
      assert.strictEqual(store.has(STORAGE_KEYS.AUTO_LOAD_ENABLED), false);
      assert.strictEqual(store.has(STORAGE_KEYS.CLOUD_PROVIDER), false);
      assert.strictEqual(store.has(STORAGE_KEYS.REMEMBER_API_KEY), false);
      assert.strictEqual(store.has(STORAGE_KEYS.SKIP_AI_SETUP), false);
      assert.strictEqual(store.has(STORAGE_KEYS.REMEMBER_CHOICE), false);
    });

    it("should not remove HAS_ENABLED_LOCAL_MODELS persistent flag", () => {
      store.set(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS, "true");
      clearModelPreferences();
      assert.strictEqual(
        store.get(STORAGE_KEYS.HAS_ENABLED_LOCAL_MODELS),
        "true",
      );
    });

    it("should be a no-op when localStorage is undefined", () => {
      Object.defineProperty(globalThis, "localStorage", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      assert.doesNotThrow(() => {
        clearModelPreferences();
      });
    });
  });
});
