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

test("serializeMeta leaves plain metadata untouched", () => {
  assert.equal(serializeMeta({ count: 3, ok: true }), '{"count":3,"ok":true}');
});
