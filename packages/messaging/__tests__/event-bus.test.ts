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
});
