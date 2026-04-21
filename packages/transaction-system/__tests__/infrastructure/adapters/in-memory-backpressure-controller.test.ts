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
      controller.accept();
      controller.accept();
      controller.accept();

      expect(controller.canAccept()).toBe(false);
    });

    it("should return true again after completing work", () => {
      controller.accept();
      controller.accept();
      controller.accept();
      controller.complete();

      expect(controller.canAccept()).toBe(true);
    });
  });

  describe("accept()", () => {
    it("should increment active count when under capacity", () => {
      controller.accept();
      controller.accept();

      expect(controller.canAccept()).toBe(true);
    });

    it("should queue work when at capacity", () => {
      controller.accept();
      controller.accept();
      controller.accept();
      controller.accept();

      expect(controller.queueDepth()).toBe(1);
    });
  });

  describe("complete()", () => {
    it("should decrement active count", () => {
      controller.accept();
      controller.accept();
      controller.complete();

      expect(controller.canAccept()).toBe(true);
    });

    it("should process queued items when capacity is available", () => {
      controller.accept();
      controller.accept();
      controller.accept();
      controller.accept();

      expect(controller.queueDepth()).toBe(1);

      controller.complete();

      expect(controller.queueDepth()).toBe(0);
    });

    it("should handle complete with no active work gracefully", () => {
      controller.complete();

      expect(controller.canAccept()).toBe(true);
    });
  });

  describe("queueDepth()", () => {
    it("should return 0 when no work is queued", () => {
      expect(controller.queueDepth()).toBe(0);
    });

    it("should return the number of queued items", () => {
      controller.accept();
      controller.accept();
      controller.accept();
      controller.accept();
      controller.accept();

      expect(controller.queueDepth()).toBe(2);
    });
  });

  describe("setMaxConcurrency()", () => {
    it("should update the max concurrency limit", () => {
      controller.accept();
      controller.accept();
      controller.accept();

      expect(controller.canAccept()).toBe(false);

      controller.setMaxConcurrency(5);

      expect(controller.canAccept()).toBe(true);
    });
  });
});
