import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeMeta } from "./structured-logger";

test("serializeMeta surfaces Error fields instead of {}", () => {
  const out = serializeMeta({ error: new Error("boom") });
  const parsed = JSON.parse(out) as {
    error: { name: string; message: string; stack?: string };
  };
  assert.equal(parsed.error.name, "Error");
  assert.equal(parsed.error.message, "boom");
  assert.ok(
    typeof parsed.error.stack === "string" && parsed.error.stack.length > 0,
  );
});

test("serializeMeta unwraps a nested Error", () => {
  const out = serializeMeta({ ctx: { cause: new TypeError("bad input") } });
  assert.match(out, /"name":"TypeError"/);
  assert.match(out, /"message":"bad input"/);
});

test("serializeMeta keeps enumerable own-properties of Error subclasses", () => {
  class StageError extends Error {
    constructor(
      public readonly stage: number,
      public readonly statusCode: number,
    ) {
      super("stage failed");
      this.name = "StageError";
    }
  }
  const out = serializeMeta({ error: new StageError(2, 500) });
  const parsed = JSON.parse(out) as {
    error: { name: string; message: string; stage: number; statusCode: number };
  };
  assert.equal(parsed.error.name, "StageError");
  assert.equal(parsed.error.message, "stage failed");
  assert.equal(parsed.error.stage, 2);
  assert.equal(parsed.error.statusCode, 500);
});

test("serializeMeta leaves plain metadata untouched", () => {
  assert.equal(serializeMeta({ count: 3, ok: true }), '{"count":3,"ok":true}');
});

test("serializeMeta never throws on circular metadata", () => {
  const circular: Record<string, unknown> = { label: "x" };
  circular.self = circular;
  let out = "";
  assert.doesNotThrow(() => {
    out = serializeMeta({ circular });
  });
  assert.match(out, /unserializable/);
});
