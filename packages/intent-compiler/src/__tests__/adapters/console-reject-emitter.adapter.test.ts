import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ConsoleRejectEmitterAdapter } from "../../infrastructure/adapters/console-reject-emitter.adapter.js";
import { Rejection } from "../../domain/rejection.js";

describe("ConsoleRejectEmitterAdapter", () => {
  let adapter: ConsoleRejectEmitterAdapter;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new ConsoleRejectEmitterAdapter();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe("emit", () => {
    it("should emit rejection with formatted message", () => {
      const rejection = new Rejection("Test rejection reason");

      adapter.emit(rejection);

      assert.ok(errorSpy.mock.calls.length > 0);
      const message = errorSpy.mock.calls[0][0] as string;
      assert.ok(message.includes("Intent Compiler Rejection"));
      assert.ok(message.includes("Test rejection reason"));
    });

    it("should include timestamp in emitted message", () => {
      const rejection = new Rejection("Test reason");

      adapter.emit(rejection);

      const message = errorSpy.mock.calls[0][0] as string;
      assert.match(message, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should preserve rejection reason exactly", () => {
      const reason = "Complex validation failed: property X is invalid";
      const rejection = new Rejection(reason);

      adapter.emit(rejection);

      const message = errorSpy.mock.calls[0][0] as string;
      assert.ok(message.includes(reason));
    });

    it("should log stack trace if available", () => {
      const rejection = new Rejection("Test reason");
      rejection.stack = "Error: Test\n  at testFunction (file.ts:123)";

      adapter.emit(rejection);

      assert.strictEqual(errorSpy.mock.calls.length, 2);
      assert.strictEqual(errorSpy.mock.calls[1][0], "Stack trace:");
      assert.strictEqual(errorSpy.mock.calls[1][1], rejection.stack);
    });

    it("should emit without error when stack trace is unavailable", () => {
      const rejection = new Rejection("Test reason");

      assert.doesNotThrow(() => {
        adapter.emit(rejection);
      });

      assert.ok(errorSpy.mock.calls.length >= 1);
      const message = errorSpy.mock.calls[0][0] as string;
      assert.ok(message.includes("Test reason"));
    });

    it("should handle multiple rejections independently", () => {
      const rejection1 = new Rejection("First reason");
      const rejection2 = new Rejection("Second reason");

      adapter.emit(rejection1);
      adapter.emit(rejection2);

      assert.ok(errorSpy.mock.calls.length >= 2);
      assert.ok((errorSpy.mock.calls[0][0] as string).includes("First reason"));
      const secondCallIndex = errorSpy.mock.calls.findIndex((call) =>
        (call[0] as string).includes("Second reason"),
      );
      assert.ok(secondCallIndex > 0);
    });
  });
});
