import assert from "node:assert";
import { InMemoryEventBusAdapter } from "../../infrastructure/adapters/in-memory-event-bus.adapter";

(async () => {
  // Test 1: should subscribe and receive events
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
  console.log("✅ Test 1: subscribe and receive events - passed");

  // Test 2: should return unsubscribe function
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
  console.log("✅ Test 2: unsubscribe function works - passed");

  // Test 3: should support multiple subscribers
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
  console.log("✅ Test 3: multiple subscribers - passed");

  // Test 4: should clear all subscriptions
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
  console.log("✅ Test 4: clear all subscriptions - passed");

  // Test 5: should handle missing handlers gracefully
  const eventBus5 = new InMemoryEventBusAdapter();

  eventBus5.publish({
    type: "nonexistent-event",
    payload: { message: "test" },
    timestamp: Date.now(),
    source: "test",
  });

  console.log("✅ Test 5: missing handlers handled gracefully - passed");

  console.log("✅ All InMemoryEventBusAdapter tests passed.");
})();
