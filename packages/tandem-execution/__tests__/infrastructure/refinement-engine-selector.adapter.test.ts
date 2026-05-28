import assert from "node:assert";
import { describe, it } from "node:test";
import { RefinementEngineSelectorAdapter } from "../../src/infrastructure/adapters/refinement-engine-selector.adapter.js";
import type { CloudProviderHealthPort } from "../../src/application/ports/cloud-provider-health.port.js";
import type { TandemConfigPersistencePort } from "../../src/application/ports/tandem-config-persistence.port.js";
import type { RefinementEngine, TandemConfig } from "../../src/domain/index.js";
import { DEFAULT_TANDEM_CONFIG, ok } from "../../src/domain/index.js";

// Mock CloudProviderHealthPort
class MockCloudProviderHealthPort implements CloudProviderHealthPort {
  constructor(public providers: RefinementEngine[] = []) {}

  async getProvidersHealth() {
    return ok(this.providers);
  }
}

// Mock TandemConfigPersistencePort
class MockTandemConfigPersistence implements TandemConfigPersistencePort {
  constructor(public config: TandemConfig = { ...DEFAULT_TANDEM_CONFIG }) {}

  read() {
    return ok(this.config);
  }

  write(config: TandemConfig) {
    this.config = config;
    return ok(undefined);
  }

  reset() {
    this.config = { ...DEFAULT_TANDEM_CONFIG };
    return ok(undefined);
  }
}

describe("RefinementEngineSelectorAdapter", () => {
  it("should get selectable engines: filters UNAVAILABLE/UNVALIDATED, sorts BYOK first, then ENV", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      { id: "byok-1", name: "OpenAI", type: "BYOK", healthState: "VALID" },
      {
        id: "byok-2",
        name: "Anthropic",
        type: "BYOK",
        healthState: "UNAVAILABLE",
      },
      {
        id: "env-2",
        name: "EnvSecondary",
        type: "ENV",
        healthState: "UNVALIDATED",
      },
      { id: "byok-3", name: "Cohere", type: "BYOK", healthState: "DEGRADED" },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence();
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getSelectableEngines();
    assert.strictEqual(result.success, true);

    if (result.success) {
      assert.strictEqual(result.value.length, 3);
      // BYOK first, then ENV. Within types, sorted alphabetically by name.
      // Valid/Degraded engines: OpenAI (BYOK, VALID), Cohere (BYOK, DEGRADED), EnvDefault (ENV, VALID).
      // Expected sorted: Cohere (BYOK), OpenAI (BYOK), EnvDefault (ENV).
      assert.deepEqual(result.value[0], {
        id: "byok-3",
        label: "Cohere (BYOK)",
        type: "BYOK",
        healthState: "DEGRADED",
      });
      assert.deepEqual(result.value[1], {
        id: "byok-1",
        label: "OpenAI (BYOK)",
        type: "BYOK",
        healthState: "VALID",
      });
      assert.deepEqual(result.value[2], {
        id: "env-1",
        label: "EnvDefault (ENV)",
        type: "ENV",
        healthState: "VALID",
      });
    }
  });

  it("should return empty list when no engines are valid or degraded", async () => {
    const providers: RefinementEngine[] = [
      {
        id: "env-1",
        name: "EnvDefault",
        type: "ENV",
        healthState: "UNAVAILABLE",
      },
      {
        id: "byok-1",
        name: "OpenAI",
        type: "BYOK",
        healthState: "UNVALIDATED",
      },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence();
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getSelectableEngines();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.length, 0);
    }
  });

  it("should resolve active engine: default priority (BYOK > ENV) when both are VALID", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      { id: "byok-1", name: "OpenAI", type: "BYOK", healthState: "VALID" },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    // Config default refinementEngine is "ENV", representing default behavior
    const persistencePort = new MockTandemConfigPersistence();
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      // Should pick BYOK as the default
      assert.ok(result.value);
      assert.strictEqual(result.value!.id, "byok-1");
    }
  });

  it("should resolve active engine: fallback to ENV when BYOK is not valid", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      {
        id: "byok-1",
        name: "OpenAI",
        type: "BYOK",
        healthState: "UNAVAILABLE",
      },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence();
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value);
      assert.strictEqual(result.value!.id, "env-1");
    }
  });

  it("should resolve active engine: user override to specific provider ID", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      { id: "byok-1", name: "OpenAI", type: "BYOK", healthState: "VALID" },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence({
      ...DEFAULT_TANDEM_CONFIG,
      refinementEngine: "env-1", // Overridden explicitly to EnvDefault
    });
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value);
      assert.strictEqual(result.value!.id, "env-1"); // Honors override
    }
  });

  it("should resolve active engine: return null if user overridden specific provider is not valid", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      {
        id: "byok-1",
        name: "OpenAI",
        type: "BYOK",
        healthState: "UNAVAILABLE",
      },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence({
      ...DEFAULT_TANDEM_CONFIG,
      refinementEngine: "byok-1", // Overridden explicitly to OpenAI (which is UNAVAILABLE)
    });
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value, null);
    }
  });

  it("should resolve active engine: user override to general 'BYOK' type", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      { id: "byok-1", name: "OpenAI", type: "BYOK", healthState: "VALID" },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence({
      ...DEFAULT_TANDEM_CONFIG,
      refinementEngine: "BYOK", // Overridden explicitly to general BYOK
    });
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value);
      assert.strictEqual(result.value!.id, "byok-1");
    }
  });

  it("should resolve active engine: return null if user override is general 'BYOK' but no BYOK is valid", async () => {
    const providers: RefinementEngine[] = [
      { id: "env-1", name: "EnvDefault", type: "ENV", healthState: "VALID" },
      {
        id: "byok-1",
        name: "OpenAI",
        type: "BYOK",
        healthState: "UNAVAILABLE",
      },
    ];

    const healthPort = new MockCloudProviderHealthPort(providers);
    const persistencePort = new MockTandemConfigPersistence({
      ...DEFAULT_TANDEM_CONFIG,
      refinementEngine: "BYOK", // Overridden explicitly to general BYOK
    });
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const result = await adapter.getActiveEngine();
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value, null); // Even though EnvDefault is valid, user requested BYOK
    }
  });

  it("should persist user override selection successfully", async () => {
    const healthPort = new MockCloudProviderHealthPort([]);
    const persistencePort = new MockTandemConfigPersistence();
    const adapter = new RefinementEngineSelectorAdapter(
      healthPort,
      persistencePort,
    );

    const selectResult = await adapter.selectEngine("byok-1");
    assert.strictEqual(selectResult.success, true);

    const readResult = persistencePort.read();
    assert.strictEqual(readResult.success, true);
    if (readResult.success) {
      assert.strictEqual(readResult.value.refinementEngine, "byok-1");
    }
  });
});
