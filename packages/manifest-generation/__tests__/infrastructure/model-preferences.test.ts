import { describe, it, expect, beforeEach } from "node:test";
import {
  createModelPreferencesAdapter,
  createLocalStorageVerificationAdapter,
} from "../../src/infrastructure/adapters/model-preferences.adapter";

type DomainModelId = "qwen-coder-3b" | "llama-3.2-3b" | "phi-3.5-mini" | "gemma-2-2b" | "qwen-coder-1.5b" | "llama-3.2-1b" | "qwen-coder-0.5b";

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

      expect(prefs.hasEnabledLocalModels).toBe(false);
      expect(prefs.lastModelId).toBeNull();
      expect(prefs.autoLoadEnabled).toBe(false);
      expect(prefs.cloudProvider).toBeNull();
    });

    it("should return stored preferences", () => {
      storage.setItem("hexagen:local-llm:last-model", "qwen-coder-3b");
      storage.setItem("hexagen:local-llm:auto-load", "true");
      storage.setItem("hexagen:manifest-flow:skip-ai-setup", "true");

      const adapter = createModelPreferencesAdapter(storage);
      const prefs = adapter.getPreferences();

      expect(prefs.lastModelId).toBe("qwen-coder-3b");
      expect(prefs.autoLoadEnabled).toBe(true);
      expect(prefs.skipAiSetup).toBe(true);
    });
  });

  describe("setPreferences", () => {
    it("should store lastModelId", () => {
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({ lastModelId: QWEN_CODER_3B });

      expect(storage.getItem("hexagen:local-llm:last-model")).toBe(QWEN_CODER_3B);
    });

    it("should remove lastModelId when set to null", () => {
      storage.setItem("hexagen:local-llm:last-model", "qwen-coder-3b");
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({ lastModelId: null });

      expect(storage.getItem("hexagen:local-llm:last-model")).toBeNull();
    });

    it("should store boolean values correctly", () => {
      const adapter = createModelPreferencesAdapter(storage);
      adapter.setPreferences({
        autoLoadEnabled: true,
        rememberChoice: true,
      });

      expect(storage.getItem("hexagen:local-llm:auto-load")).toBe("true");
      expect(storage.getItem("hexagen:manifest-flow:remember-choice")).toBe("true");
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
      expect(adapter.isModelVerified(QWEN_CODER_3B)).toBe(false);
    });

    it("should return true when verified within max age", () => {
      const now = Date.now();
      storage.setItem(
        `hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: now, downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      expect(adapter.isModelVerified(QWEN_CODER_3B, 24)).toBe(true);
    });

    it("should return false when verification is stale", () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000;
      storage.setItem(
        `hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: oldTime, downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      expect(adapter.isModelVerified(QWEN_CODER_3B, 24)).toBe(false);
    });
  });

  describe("updateModelCacheMetadata", () => {
    it("should update existing metadata", () => {
      storage.setItem(
        `hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: null, downloadCompleted: false }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      adapter.updateModelCacheMetadata(QWEN_CODER_3B, {
        verifiedAt: Date.now(),
        downloadCompleted: true,
      });

      const stored = JSON.parse(
        storage.getItem(`hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`)!,
      );
      expect(stored.verifiedAt).toBeDefined();
      expect(stored.downloadCompleted).toBe(true);
    });
  });

  describe("clearModelCacheMetadata", () => {
    it("should remove cache metadata", () => {
      storage.setItem(
        `hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`,
        JSON.stringify({ verifiedAt: Date.now(), downloadCompleted: true }),
      );

      const adapter = createLocalStorageVerificationAdapter(storage);
      adapter.clearModelCacheMetadata(QWEN_CODER_3B);

      expect(storage.getItem(`hexagen:local-llm:cache-metadata:${QWEN_CODER_3B}`)).toBeNull();
    });
  });
});