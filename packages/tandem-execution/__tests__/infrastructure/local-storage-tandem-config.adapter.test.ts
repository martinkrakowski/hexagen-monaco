import assert from "node:assert";
import { describe, it, before, beforeEach, after } from "node:test";
import { LocalStorageTandemConfigAdapter } from "../../src/infrastructure/adapters/local-storage-tandem-config.adapter.js";
import { DEFAULT_TANDEM_CONFIG } from "../../src/domain/index.js";

class MockStorage implements Storage {
  private store: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  clear(): void {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }
}

describe("LocalStorageTandemConfigAdapter", () => {
  const globalWithWindow = globalThis as unknown as {
    window?: { localStorage?: Storage };
  };
  const originalWindow = globalWithWindow.window;
  let mockStorage: MockStorage;

  before(() => {
    mockStorage = new MockStorage();
    // Setup mock window environment conforming to ADR-0036
    globalWithWindow.window = {
      localStorage: mockStorage,
    };
  });

  after(() => {
    if (originalWindow === undefined) {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = originalWindow;
    }
  });

  beforeEach(() => {
    mockStorage.clear();
  });

  it("should read default config if nothing is stored", () => {
    const adapter = new LocalStorageTandemConfigAdapter();
    const result = adapter.read();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepEqual(result.value, DEFAULT_TANDEM_CONFIG);
    }
  });

  it("should write and read back config successfully", () => {
    const adapter = new LocalStorageTandemConfigAdapter();
    const testConfig = {
      ...DEFAULT_TANDEM_CONFIG,
      enabled: true,
      localModelId: "test-model-123",
      refinementEngine: "BYOK",
      displayPreference: "append" as const,
      stageOneTimeoutSeconds: 45,
      memoryHeadroomMB: 2048,
    };

    const writeResult = adapter.write(testConfig);
    assert.strictEqual(writeResult.success, true);

    const readResult = adapter.read();
    assert.strictEqual(readResult.success, true);
    if (readResult.success) {
      assert.deepEqual(readResult.value, testConfig);
    }
  });

  it("should migrate/backfill default config keys if older version is loaded", () => {
    const adapter = new LocalStorageTandemConfigAdapter();
    // Store an incomplete config (missing autoRetryEnabled, displayPreference, etc.)
    mockStorage.setItem(
      "hexagen:tandem:config",
      JSON.stringify({
        enabled: true,
        localModelId: "legacy-model",
      }),
    );

    const result = adapter.read();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.enabled, true);
      assert.strictEqual(result.value.localModelId, "legacy-model");
      // Backfilled values
      assert.strictEqual(result.value.displayPreference, "overwrite");
      assert.strictEqual(result.value.autoRetryEnabled, true);
      assert.strictEqual(result.value.stageOneTimeoutSeconds, 60);
    }
  });

  it("should reset config successfully", () => {
    const adapter = new LocalStorageTandemConfigAdapter();
    adapter.write({
      ...DEFAULT_TANDEM_CONFIG,
      enabled: true,
    });

    const resetResult = adapter.reset();
    assert.strictEqual(resetResult.success, true);

    const readResult = adapter.read();
    assert.strictEqual(readResult.success, true);
    if (readResult.success) {
      assert.deepEqual(readResult.value, DEFAULT_TANDEM_CONFIG);
    }
  });
});
