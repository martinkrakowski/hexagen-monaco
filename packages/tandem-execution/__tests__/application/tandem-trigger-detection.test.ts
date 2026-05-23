import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TandemTriggerDetectionUseCase } from "../../src/application/tandem-trigger-detection.use-case.js";
import type { TandemConfig } from "../../src/domain/index.js";
import type { TandemConfigPersistencePort } from "../../src/application/ports/tandem-config-persistence.port.js";
import { ok } from "../../src/domain/index.js";
import type { Result } from "../../src/domain/index.js";

// ---------------------------------------------------------------------------
// In-memory mock for TandemConfigPersistencePort
// ---------------------------------------------------------------------------
function createInMemoryConfigPersistence(
  initial: TandemConfig,
): TandemConfigPersistencePort & { stored: TandemConfig } {
  let stored = { ...initial };
  return {
    get stored() {
      return stored;
    },
    read(): Result<TandemConfig> {
      return ok({ ...stored });
    },
    write(config: TandemConfig): Result<void> {
      stored = { ...config };
      return ok(undefined);
    },
    reset(): Result<void> {
      stored = { ...initial };
      return ok(undefined);
    },
  };
}

const BASE_CONFIG: TandemConfig = {
  enabled: false,
  localModelId: "mistral-7b",
  refinementEngine: "ENV",
  displayPreference: "overwrite",
  stageOneTimeoutSeconds: 60,
  memoryHeadroomMB: 4096,
  promptTemplateVersion: "v1",
  firstTimeExperienceDismissed: false,
  autoRetryEnabled: true,
  lastValidatedAt: "",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TandemTriggerDetectionUseCase — Forward Trigger", () => {
  const useCase = new TandemTriggerDetectionUseCase();

  it("fires when DOWNLOADED + VALID", () => {
    assert.strictEqual(
      useCase.checkForwardTrigger("DOWNLOADED", "VALID"),
      true,
    );
  });

  it("fires when DOWNLOADED + DEGRADED", () => {
    assert.strictEqual(
      useCase.checkForwardTrigger("DOWNLOADED", "DEGRADED"),
      true,
    );
  });

  it("does NOT fire when DOWNLOADED + UNAVAILABLE", () => {
    assert.strictEqual(
      useCase.checkForwardTrigger("DOWNLOADED", "UNAVAILABLE"),
      false,
    );
  });

  it("does NOT fire when DOWNLOADED + UNVALIDATED", () => {
    assert.strictEqual(
      useCase.checkForwardTrigger("DOWNLOADED", "UNVALIDATED"),
      false,
    );
  });

  it("does NOT fire when ACTIVE + VALID (already active, not a forward trigger)", () => {
    assert.strictEqual(useCase.checkForwardTrigger("ACTIVE", "VALID"), false);
  });

  it("does NOT fire when NOT_DOWNLOADED + VALID", () => {
    assert.strictEqual(
      useCase.checkForwardTrigger("NOT_DOWNLOADED", "VALID"),
      false,
    );
  });

  it("does NOT fire when LOADING + VALID", () => {
    assert.strictEqual(useCase.checkForwardTrigger("LOADING", "VALID"), false);
  });
});

describe("TandemTriggerDetectionUseCase — Reverse Trigger", () => {
  const useCase = new TandemTriggerDetectionUseCase();

  it("fires when ACTIVE + UNVALIDATED→VALID", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("ACTIVE", "UNVALIDATED", "VALID"),
      true,
    );
  });

  it("does NOT fire when ACTIVE + VALID→VALID (no state change)", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("ACTIVE", "VALID", "VALID"),
      false,
    );
  });

  it("does NOT fire when ACTIVE + DEGRADED→VALID (previous was not UNVALIDATED)", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("ACTIVE", "DEGRADED", "VALID"),
      false,
    );
  });

  it("does NOT fire when DOWNLOADED + UNVALIDATED→VALID (local not active)", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("DOWNLOADED", "UNVALIDATED", "VALID"),
      false,
    );
  });

  it("does NOT fire when NOT_DOWNLOADED + UNVALIDATED→VALID", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("NOT_DOWNLOADED", "UNVALIDATED", "VALID"),
      false,
    );
  });

  it("does NOT fire when ACTIVE + UNVALIDATED→DEGRADED (current not VALID)", () => {
    assert.strictEqual(
      useCase.checkReverseTrigger("ACTIVE", "UNVALIDATED", "DEGRADED"),
      false,
    );
  });
});

describe("TandemTriggerDetectionUseCase — Commit Activation", () => {
  const useCase = new TandemTriggerDetectionUseCase();

  it("Path A (local-only) sets enabled: false and persists", () => {
    const config: TandemConfig = { ...BASE_CONFIG, enabled: true };
    const persistence = createInMemoryConfigPersistence(config);

    const result = useCase.commitActivation("local-only", config, persistence);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.enabled, false);
    }
    assert.strictEqual(persistence.stored.enabled, false);
  });

  it("Path B (tandem) sets enabled: true and persists", () => {
    const config: TandemConfig = { ...BASE_CONFIG, enabled: false };
    const persistence = createInMemoryConfigPersistence(config);

    const result = useCase.commitActivation("tandem", config, persistence);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.enabled, true);
    }
    assert.strictEqual(persistence.stored.enabled, true);
  });

  it("Path C (keep-current) makes no changes and does not persist", () => {
    const config: TandemConfig = { ...BASE_CONFIG, enabled: true };
    const persistence = createInMemoryConfigPersistence(config);

    // Mutate stored to a different value to verify write is NOT called
    const originalStored = { ...persistence.stored };

    const result = useCase.commitActivation(
      "keep-current",
      config,
      persistence,
    );

    assert.strictEqual(result.success, true);
    if (result.success) {
      // Returned config is unchanged
      assert.strictEqual(result.value.enabled, config.enabled);
    }
    // Stored config is also unchanged (write was not called)
    assert.deepStrictEqual(persistence.stored, originalStored);
  });

  it("Path A preserves all other config fields", () => {
    const config: TandemConfig = {
      ...BASE_CONFIG,
      enabled: true,
      refinementEngine: "BYOK",
      displayPreference: "append",
    };
    const persistence = createInMemoryConfigPersistence(config);

    const result = useCase.commitActivation("local-only", config, persistence);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.refinementEngine, "BYOK");
      assert.strictEqual(result.value.displayPreference, "append");
      assert.strictEqual(result.value.enabled, false);
    }
  });

  it("Path B preserves all other config fields", () => {
    const config: TandemConfig = {
      ...BASE_CONFIG,
      enabled: false,
      stageOneTimeoutSeconds: 120,
    };
    const persistence = createInMemoryConfigPersistence(config);

    const result = useCase.commitActivation("tandem", config, persistence);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.stageOneTimeoutSeconds, 120);
      assert.strictEqual(result.value.enabled, true);
    }
  });
});
