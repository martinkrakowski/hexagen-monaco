import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PreFlightValidatorUseCase } from "../../src/application/use-cases/pre-flight-validator.use-case.js";

const validator = new PreFlightValidatorUseCase();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_OPTIONS = {
  prompt: "Hello world",
};

// ---------------------------------------------------------------------------
// TERMINAL_FAILURE
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — TERMINAL_FAILURE", () => {
  it("returns TERMINAL_FAILURE when local is ERROR and cloud is UNAVAILABLE", () => {
    const result = validator.validate("ERROR", "UNAVAILABLE", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, false);
    assert.match(result.value.error ?? "", /Both engines unavailable/);
  });

  it("returns TERMINAL_FAILURE when local is NOT_DOWNLOADED and cloud is UNVALIDATED", () => {
    const result = validator.validate(
      "NOT_DOWNLOADED",
      "UNVALIDATED",
      BASE_OPTIONS,
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, false);
  });

  it("returns TERMINAL_FAILURE when local is LOADING and cloud is UNAVAILABLE", () => {
    const result = validator.validate("LOADING", "UNAVAILABLE", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, false);
  });
});

// ---------------------------------------------------------------------------
// BYPASS_LOCAL — local not active, cloud valid
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — BYPASS_LOCAL (reason: none)", () => {
  it("returns BYPASS_LOCAL with reason 'none' when local is NOT_DOWNLOADED and cloud is VALID", () => {
    const result = validator.validate("NOT_DOWNLOADED", "VALID", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, true);
    assert.strictEqual(result.value.bypassLocal, true);
    assert.strictEqual(result.value.bypassReason, "none");
  });

  it("returns BYPASS_LOCAL with reason 'none' when local is DOWNLOADING and cloud is DEGRADED", () => {
    const result = validator.validate("DOWNLOADING", "DEGRADED", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, true);
    assert.strictEqual(result.value.bypassReason, "none");
  });

  it("returns BYPASS_LOCAL with reason 'none' when local is ERROR and cloud is VALID", () => {
    const result = validator.validate("ERROR", "VALID", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, true);
    assert.strictEqual(result.value.bypassReason, "none");
  });
});

// ---------------------------------------------------------------------------
// BYPASS_CLOUD
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — BYPASS_CLOUD", () => {
  it("returns BYPASS_CLOUD when local is ACTIVE and cloud is UNAVAILABLE", () => {
    const result = validator.validate("ACTIVE", "UNAVAILABLE", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
    assert.strictEqual(result.value.bypassReason, undefined);
  });

  it("returns BYPASS_CLOUD when local is ACTIVE and cloud is UNVALIDATED", () => {
    const result = validator.validate("ACTIVE", "UNVALIDATED", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });
});

// ---------------------------------------------------------------------------
// BYPASS_LOCAL — memory insufficient
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — BYPASS_LOCAL (reason: memory_insufficient)", () => {
  it("returns BYPASS_LOCAL with reason 'memory_insufficient' when device memory is below threshold", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      deviceMemoryGb: 4,
      memoryThresholdGb: 8,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, true);
    assert.strictEqual(result.value.bypassReason, "memory_insufficient");
  });

  it("does NOT bypass when device memory equals threshold", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      deviceMemoryGb: 8,
      memoryThresholdGb: 8,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });

  it("does NOT bypass when device memory exceeds threshold", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      deviceMemoryGb: 16,
      memoryThresholdGb: 8,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });

  it("skips memory check when deviceMemoryGb is undefined", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      memoryThresholdGb: 8,
      // deviceMemoryGb intentionally omitted
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });

  it("skips memory check when memoryThresholdGb is undefined", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      deviceMemoryGb: 4,
      // memoryThresholdGb intentionally omitted
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });
});

// ---------------------------------------------------------------------------
// BYPASS_LOCAL — context overflow
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — BYPASS_LOCAL (reason: context_overflow)", () => {
  it("returns BYPASS_LOCAL with reason 'context_overflow' when prompt exceeds 80% of context limit", () => {
    // 1000 words × 1.3 = 1300 tokens; 80% of 1500 = 1200 → 1300 > 1200 → overflow
    const longPrompt = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(
      " ",
    );
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: longPrompt,
      cloudContextLimit: 1500,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, true);
    assert.strictEqual(result.value.bypassReason, "context_overflow");
  });

  it("does NOT bypass when prompt is within 80% of context limit", () => {
    // 10 words × 1.3 = 13 tokens; 80% of 1000 = 800 → 13 < 800 → no overflow
    const shortPrompt = "one two three four five six seven eight nine ten";
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: shortPrompt,
      cloudContextLimit: 1000,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });

  it("skips context check when cloudContextLimit is undefined", () => {
    const longPrompt = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(
      " ",
    );
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: longPrompt,
      // cloudContextLimit intentionally omitted
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });
});

// ---------------------------------------------------------------------------
// PROCEED_TANDEM
// ---------------------------------------------------------------------------
describe("PreFlightValidatorUseCase — PROCEED_TANDEM", () => {
  it("returns PROCEED_TANDEM when local is ACTIVE and cloud is VALID", () => {
    const result = validator.validate("ACTIVE", "VALID", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
    assert.strictEqual(result.value.bypassReason, undefined);
  });

  it("returns PROCEED_TANDEM when local is ACTIVE and cloud is DEGRADED", () => {
    const result = validator.validate("ACTIVE", "DEGRADED", BASE_OPTIONS);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });

  it("returns PROCEED_TANDEM when memory is sufficient and prompt is within limit", () => {
    const result = validator.validate("ACTIVE", "VALID", {
      prompt: "Hello world",
      deviceMemoryGb: 16,
      memoryThresholdGb: 8,
      cloudContextLimit: 4096,
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.bypassLocal, false);
  });
});
