import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createModelPreferencesAdapter,
  createLocalStorageVerificationAdapter,
} from "../../src/infrastructure/adapters/model-preferences.adapter";
import { MODEL_PREFERENCE_KEYS } from "@hexagen/shared";

type DomainModelId =
  | "qwen-coder-3b"
  | "llama-3.2-3b"
  | "qwen3-8b"
  | "qwen3-4b"
  | "qwen3-1.7b"
  | "qwen3-0.6b"
  | "qwen-coder-1.5b"
  | "llama-3.2-1b"
  | "qwen-coder-0.5b";

const QWEN_CODER_3B: DomainModelId = "qwen-coder-3b";

interface TestStorage {
  data: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createTestStorage(): TestStorage {
  const data: Record<string, string> = {};
  return {
    data,
    getItem(key: string): string | null {
      return data[key] ?? null;
    },
    setItem(key: string, value: string): void {
      data[key] = value;
    },
    removeItem(key: string): void {
      delete data[key];
    },
  };
}

describe("ModelPreferencesAdapter", () => {
  let storage: TestStorage;

  beforeEach(() => {
    storage = createTestStorage();
  });

  describe("getPreferences", () => {
    it("should return default preferences when storage is empty", () => {
      const adapter = createModelPreferencesAdapter(storage);
      const prefs = adapter.getPreferences();

      assert.strictEqual(prefs.hasEnabledLocalModels, false);
      assert.strictEqual(prefs.lastModelId, null);
      assert.strictEqual(prefs.autoLoadEnabled, false);
      assert.strictEqual(prefs.cloudProvider, null);
    });

    it("should return stored preferences", () => {
      storage.setItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID, "qwen-coder-3b");
      storage.setItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED, "true");
      storage.setItem(MODEL_PREFERENCE_KEYS.SKIP_AI_SETUP, "true");

      const adapter = createModelPreferencesAdapter(storage);
      const prefs = adapter.getPreferences();

      assert.strictEqual(prefs.lastModelId, "qwen-coder-3b");
      assert.strictEqual(prefs.autoLoadEnabled, true);
      assert.strictEqual(prefs.skipAiSetup, true);
    });
  });

  describe("setPreferences", () => {
    it("should store lastModelId", () => {
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({ lastModelId: QWEN_CODER_3B });

      assert.strictEqual(
        storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID),
        QWEN_CODER_3B,
      );
    });

    it("should remove lastModelId when set to null", () => {
      storage.setItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID, "qwen-coder-3b");
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({ lastModelId: null });

      assert.strictEqual(
        storage.getItem(MODEL_PREFERENCE_KEYS.LAST_MODEL_ID),
        null,
      );
    });

    it("should store boolean values correctly", () => {
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({
        autoLoadEnabled: true,
        rememberChoice: true,
      });

      assert.strictEqual(
        storage.getItem(MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED),
        "true",
      );
      assert.strictEqual(
        storage.getItem(MODEL_PREFERENCE_KEYS.REMEMBER_CHOICE),
        "true",
      );
    });
  });
});

describe("LocalStorageVerificationAdapter", () => {
  let storage: TestStorage;

  beforeEach(() => {
    storage = createTestStorage();
  });

  describe("isModelVerified", () => {
    it("should return false when no cache metadata exists", () => {
      const adapter = createLocalStorageVerificationAdapter(storage);
      assert.strictEqual(adapter.isModelVerified(QWEN_CODER_3B), false);
    });

    it("should return true when verified within max age", () => {
      const now = Date.now();
      storage.setItem(
        `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: now, downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      assert.strictEqual(adapter.isModelVerified(QWEN_CODER_3B, 24), true);
    });

    it("should return false when verification is stale", () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      storage.setItem(
        `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: oldTime, downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      assert.strictEqual(adapter.isModelVerified(QWEN_CODER_3B, 24), false);
    });
  });

  describe("updateModelCacheMetadata", () => {
    it("should update existing metadata", () => {
      storage.setItem(
        `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: null, downloadCompleted: false }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      adapter.updateModelCacheMetadata(QWEN_CODER_3B, {
        verifiedAt: Date.now(),
        downloadCompleted: true,
      });

      const stored = JSON.parse(
        storage.getItem(
          `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        )!,
      );
      assert.ok(stored.verifiedAt != null);
      assert.strictEqual(stored.downloadCompleted, true);
    });
  });

  describe("clearModelCacheMetadata", () => {
    it("should remove cache metadata", () => {
      storage.setItem(
        `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: Date.now(), downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      adapter.clearModelCacheMetadata(QWEN_CODER_3B);

      assert.strictEqual(
        storage.getItem(
          `${MODEL_PREFERENCE_KEYS.MODEL_CACHE_METADATA_PREFIX}${QWEN_CODER_3B}`,
        ),
        null,
      );
    });
  });
});
