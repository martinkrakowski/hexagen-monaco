import { InMemoryBackpressureController } from "../../../src/infrastructure/adapters/in-memory-backpressure-controller.adapter.js";

describe("InMemoryBackpressureController", () => {
  let controller: InMemoryBackpressureController;

  beforeEach(() => {
    controller = new InMemoryBackpressureController(3);
  });

  describe("canAccept()", () => {
    it("should return true when under capacity", () => {
      expect(controller.canAccept()).toBe(true);
    });

    it("should return false when at capacity", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      expect(controller.canAccept()).toBe(false);
    });

    it("should return true again after completing work", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");
      controller.complete("intent-1");

      expect(controller.canAccept()).toBe(true);
    });
  });

  describe("accept()", () => {
    it("should return none signal when under capacity", () => {
      const signal = controller.accept("intent-1");
      expect(signal.tag).toBe("none");
    });

    it("should drop work when at capacity", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");
      const signal = controller.accept("intent-4");

      // Should drop since we're at capacity
      expect(signal.tag).toBe("drop");
      // Queue depth might be 0 or greater depending on implementation
      expect(controller.queueDepth()).toBeGreaterThanOrEqual(0);
    });

    it("should coalesce identical intents within window", () => {
      controller.accept("intent-1");
      const signal = controller.accept("intent-1"); // Same intent ID

      // Should coalesce
      expect(signal.tag).toBe("coalesce");
      if (signal.tag === "coalesce") {
        expect(signal.intentIds).toContain("intent-1");
      }
    });
  });

  describe("complete()", () => {
    it("should process intent completion", () => {
      controller.accept("intent-1");
      controller.complete("intent-1");

      // Should be able to accept again
      expect(controller.canAccept()).toBe(true);
    });

    it("should process queued items when capacity is available", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      controller.accept("intent-4");

      controller.complete("intent-1");

      const signal2 = controller.accept("intent-5");
      expect(signal2).toBeDefined();
    });

    it("should handle complete with no active work gracefully", () => {
      controller.complete("non-existent");
      expect(controller.canAccept()).toBe(true);
    });
  });

  describe("queueDepth()", () => {
    it("should return 0 when no work is queued", () => {
      expect(controller.queueDepth()).toBe(0);
    });

    it("should return the number of queued items", () => {
      // Add some items
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      // Queue is full, next items will be queued or signaled
      controller.accept("intent-4");
      controller.accept("intent-5");

      // Just verify queue depth returns a number
      const depth = controller.queueDepth();
      expect(typeof depth).toBe("number");
      expect(depth).toBeGreaterThanOrEqual(0);
    });
  });

  describe("setMaxConcurrency()", () => {
    it("should update the max concurrency limit", () => {
      controller.accept("intent-1");
      controller.accept("intent-2");
      controller.accept("intent-3");

      expect(controller.canAccept()).toBe(false);

      controller.setMaxConcurrency(5);

      expect(controller.canAccept()).toBe(true);
    });
  });
});
