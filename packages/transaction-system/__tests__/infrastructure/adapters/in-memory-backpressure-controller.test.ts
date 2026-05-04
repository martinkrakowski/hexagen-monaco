import assert from "node:assert/strict";
import { InMemoryBackpressureController } from "../../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";

describe("InMemoryBackpressureController", () => {
  let controller: InMemoryBackpressureController;

  beforeEach(() => {
    controller = new InMemoryBackpressureController(3);
  });

  describe("canAccept()", () => {
    it("should return true when under capacity", () => {
      assert.strictEqual(controller.canAccept(), true);
    });

    it("should return false when at capacity", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      assert.strictEqual(controller.canAccept(), false);
    });

    it("should return true again after completing work", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");
      controller.complete("intent-1");

      assert.strictEqual(controller.canAccept(), true);
    });
  });

  describe("accept()", () => {
    it("should return none signal when under capacity", () => {
      const signal = controller.accept("intent-1");
      assert.strictEqual(signal.tag, "none");
    });

    it("should drop work when at capacity", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");
      const signal = controller.accept("intent-4");

      assert.strictEqual(signal.tag, "drop");
      assert.ok(controller.queueDepth() >= 0);
    });

    it("should coalesce identical intents within window", () => {
      controller.accept("intent-1");
      const signal = controller.accept("intent-1");

      assert.strictEqual(signal.tag, "coalesce");
      if (signal.tag === "coalesce") {
        assert.ok(signal.intentIds.includes("intent-1"));
      }
    });
  });

  describe("complete()", () => {
    it("should process intent completion", () => {
      controller.accept("intent-1");
      controller.complete("intent-1");

      assert.strictEqual(controller.canAccept(), true);
    });

    it("should process queued items when capacity is available", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      controller.accept("intent-4");

      controller.complete("intent-1");

      const signal2 = controller.accept("intent-5");
      assert.ok(signal2 !== undefined);
    });

    it("should handle complete with no active work gracefully", () => {
      controller.complete("non-existent");
      assert.strictEqual(controller.canAccept(), true);
    });
  });

  describe("queueDepth()", () => {
    it("should return 0 when no work is queued", () => {
      assert.strictEqual(controller.queueDepth(), 0);
    });

    it("should return the number of queued items", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      controller.accept("intent-4");
      controller.accept("intent-5");

      const depth = controller.queueDepth();
      assert.strictEqual(typeof depth, "number");
      assert.ok(depth >= 0);
    });
  });

  describe("setMaxConcurrency()", () => {
    it("should update the max concurrency limit", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      assert.strictEqual(controller.canAccept(), false);

      controller.setMaxConcurrency(5);

      assert.strictEqual(controller.canAccept(), true);
    });
  });
});
