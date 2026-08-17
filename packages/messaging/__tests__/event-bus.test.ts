import assert from "node:assert";
import { describe, it } from "vitest";
import { InMemoryEventBusAdapter } from "../src/infrastructure/adapters/in-memory-event-bus.adapter";

describe("event-bus", () => {
  it("should subscribe and receive events", () => {
    const eventBus1 = new InMemoryEventBusAdapter();
    const receivedEvents: string[] = [];

    eventBus1.subscribe("test-event", (event) => {
      receivedEvents.push(
        (event as { payload: { message: string } }).payload.message,
      );
    });

    eventBus1.publish({
      type: "test-event",
      payload: { message: "hello" },
      timestamp: Date.now(),
      source: "test",
    });

    assert.strictEqual(
      receivedEvents[0],
      "hello",
      "Should receive published event",
    );
  });

  it("should return unsubscribe function", () => {
    const eventBus2 = new InMemoryEventBusAdapter();
    const receivedAfterUnsubscribe: string[] = [];

    const unsubscribe = eventBus2.subscribe("test-event", (event) => {
      receivedAfterUnsubscribe.push(
        (event as { payload: { message: string } }).payload.message,
      );
    });

    unsubscribe();

    eventBus2.publish({
      type: "test-event",
      payload: { message: "after unsubscribe" },
      timestamp: Date.now(),
      source: "test",
    });

    assert.strictEqual(
      receivedAfterUnsubscribe.length,
      0,
      "Should not receive after unsubscribe",
    );
  });

  it("should support multiple subscribers", () => {
    const eventBus3 = new InMemoryEventBusAdapter();
    const first: string[] = [];
    const second: string[] = [];

    eventBus3.subscribe("test-event", (e) =>
      first.push((e as { payload: { message: string } }).payload.message),
    );
    eventBus3.subscribe("test-event", (e) =>
      second.push((e as { payload: { message: string } }).payload.message),
    );

    eventBus3.publish({
      type: "test-event",
      payload: { message: "shared" },
      timestamp: Date.now(),
      source: "test",
    });

    assert.strictEqual(first[0], "shared", "First subscriber should receive");
    assert.strictEqual(second[0], "shared", "Second subscriber should receive");
  });

  it("should clear all subscriptions", () => {
    const eventBus4 = new InMemoryEventBusAdapter();
    const receivedAfterClear: string[] = [];

    eventBus4.subscribe("test-event", (e) =>
      receivedAfterClear.push(
        (e as { payload: { message: string } }).payload.message,
      ),
    );
    eventBus4.clear();

    eventBus4.publish({
      type: "test-event",
      payload: { message: "after clear" },
      timestamp: Date.now(),
      source: "test",
    });

    assert.strictEqual(
      receivedAfterClear.length,
      0,
      "Should not receive after clear",
    );
  });

  it("should handle missing handlers gracefully", () => {
    const eventBus5 = new InMemoryEventBusAdapter();

    eventBus5.publish({
      type: "nonexistent-event",
      payload: { message: "test" },
      timestamp: Date.now(),
      source: "test",
    });
  });

  // The adapter's `publish` swallows handler exceptions on purpose — its own
  // comment says "Handlers must not throw; errors are silently ignored to
  // protect other subscribers". Nothing verified either half of that claim.
  it("should keep delivering to later subscribers when an earlier one throws", () => {
    const eventBus6 = new InMemoryEventBusAdapter();
    const delivered: string[] = [];

    eventBus6.subscribe("test-event", () => {
      throw new Error("first subscriber exploded");
    });
    eventBus6.subscribe("test-event", () => {
      delivered.push("second");
    });

    assert.doesNotThrow(
      () =>
        eventBus6.publish({
          type: "test-event",
          payload: { message: "resilient" },
          timestamp: Date.now(),
          source: "test",
        }),
      "A throwing subscriber must not propagate out of publish",
    );

    assert.deepStrictEqual(
      delivered,
      ["second"],
      "A throwing subscriber must not stop delivery to the rest",
    );
  });

  // Only the closure returned by `subscribe` was covered; `unsubscribe` is a
  // separate method on EventBusPort and had no test of its own.
  it("should stop delivery via the explicit unsubscribe method", () => {
    const eventBus7 = new InMemoryEventBusAdapter();
    const removed: string[] = [];
    const kept: string[] = [];

    const removedHandler = () => removed.push("removed");
    eventBus7.subscribe("test-event", removedHandler);
    eventBus7.subscribe("test-event", () => kept.push("kept"));

    eventBus7.unsubscribe("test-event", removedHandler);

    eventBus7.publish({
      type: "test-event",
      payload: { message: "targeted" },
      timestamp: Date.now(),
      source: "test",
    });

    assert.strictEqual(
      removed.length,
      0,
      "The unsubscribed handler must not receive",
    );
    assert.deepStrictEqual(
      kept,
      ["kept"],
      "unsubscribe must remove only the handler it was given",
    );
  });
});
