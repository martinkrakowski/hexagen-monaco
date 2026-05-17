import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSpecSummary } from "../extract-spec-summary";

describe("extractSpecSummary", () => {
  it("counts bounded contexts", () => {
    const result = extractSpecSummary({
      bounded_contexts: [{ name: "a" }, { name: "b" }],
    });
    assert.strictEqual(result.contextCount, 2);
  });

  it("counts aggregates across contexts", () => {
    const result = extractSpecSummary({
      bounded_contexts: [{ aggregates: [1, 2] }, { aggregates: [3] }],
    });
    assert.strictEqual(result.aggregateCount, 3);
  });

  it("counts value objects across contexts", () => {
    const result = extractSpecSummary({
      bounded_contexts: [{ value_objects: [1, 2, 3] }],
    });
    assert.strictEqual(result.valueObjectCount, 3);
  });

  it("counts use cases", () => {
    const result = extractSpecSummary({
      use_cases: { ctx1: [1, 2], ctx2: [3] },
    });
    assert.strictEqual(result.useCaseCount, 3);
  });

  it("counts context mappings", () => {
    const result = extractSpecSummary({
      context_mappings: [1, 2, 3, 4],
    });
    assert.strictEqual(result.mappingCount, 4);
  });

  it("counts event bus subscriptions", () => {
    const result = extractSpecSummary({
      event_bus: { subscriptions: [1, 2, 3] },
    });
    assert.strictEqual(result.eventBusSubscriptionCount, 3);
  });

  it("handles missing bounded_contexts", () => {
    const result = extractSpecSummary({});
    assert.strictEqual(result.contextCount, 0);
  });

  it("handles missing use_cases", () => {
    const result = extractSpecSummary({ bounded_contexts: [] });
    assert.strictEqual(result.useCaseCount, 0);
  });

  it("handles missing event_bus", () => {
    const result = extractSpecSummary({
      bounded_contexts: [],
      context_mappings: [],
    });
    assert.strictEqual(result.eventBusSubscriptionCount, 0);
  });

  it("handles empty structures", () => {
    const result = extractSpecSummary({
      bounded_contexts: [],
      use_cases: {},
      context_mappings: [],
      event_bus: { subscriptions: [] },
    });
    assert.strictEqual(result.contextCount, 0);
    assert.strictEqual(result.aggregateCount, 0);
    assert.strictEqual(result.valueObjectCount, 0);
    assert.strictEqual(result.useCaseCount, 0);
    assert.strictEqual(result.mappingCount, 0);
    assert.strictEqual(result.eventBusSubscriptionCount, 0);
  });
});
