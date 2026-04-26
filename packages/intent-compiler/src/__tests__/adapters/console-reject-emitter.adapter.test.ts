import { ConsoleRejectEmitterAdapter } from "../../infrastructure/adapters/console-reject-emitter.adapter.js";
import { Rejection } from "../../domain/rejection.js";

describe("ConsoleRejectEmitterAdapter", () => {
  let adapter: ConsoleRejectEmitterAdapter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    adapter = new ConsoleRejectEmitterAdapter();
    errorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe("emit", () => {
    it("should emit rejection with formatted message", () => {
      const rejection = new Rejection("Test rejection reason");

      adapter.emit(rejection);

      expect(errorSpy).toHaveBeenCalled();
      const message = errorSpy.mock.calls[0][0] as string;
      expect(message).toContain("Intent Compiler Rejection");
      expect(message).toContain("Test rejection reason");
    });

    it("should include timestamp in emitted message", () => {
      const rejection = new Rejection("Test reason");

      adapter.emit(rejection);

      const message = errorSpy.mock.calls[0][0] as string;
      expect(message).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should preserve rejection reason exactly", () => {
      const reason = "Complex validation failed: property X is invalid";
      const rejection = new Rejection(reason);

      adapter.emit(rejection);

      const message = errorSpy.mock.calls[0][0] as string;
      expect(message).toContain(reason);
    });

    it("should log stack trace if available", () => {
      const rejection = new Rejection("Test reason");
      rejection.stack = "Error: Test\n  at testFunction (file.ts:123)";

      adapter.emit(rejection);

      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[1][0]).toBe("Stack trace:");
      expect(errorSpy.mock.calls[1][1]).toBe(rejection.stack);
    });

    it("should emit without error when stack trace is unavailable", () => {
      const rejection = new Rejection("Test reason");

      expect(() => {
        adapter.emit(rejection);
      }).not.toThrow();

      // Verify the message was logged
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const message = errorSpy.mock.calls[0][0] as string;
      expect(message).toContain("Test reason");
    });

    it("should handle multiple rejections independently", () => {
      const rejection1 = new Rejection("First reason");
      const rejection2 = new Rejection("Second reason");

      adapter.emit(rejection1);
      adapter.emit(rejection2);

      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(errorSpy.mock.calls[0][0]).toContain("First reason");
      const secondCallIndex = errorSpy.mock.calls.findIndex((call) =>
        (call[0] as string).includes("Second reason"),
      );
      expect(secondCallIndex).toBeGreaterThan(0);
    });
  });
});
