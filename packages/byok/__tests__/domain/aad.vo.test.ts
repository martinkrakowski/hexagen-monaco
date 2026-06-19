import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  constructAAD,
  aadToBuffer,
} from "../../src/domain/value-objects/aad.vo.js";

describe("constructAAD", () => {
  it("constructs AAD with userId", () => {
    const aad = constructAAD("user-123");
    assert.strictEqual(aad.userId, "user-123");
  });

  it("constructs AAD preserving the exact userId string", () => {
    const aad = constructAAD("org:team:user-456");
    assert.strictEqual(aad.userId, "org:team:user-456");
  });
});

describe("aadToBuffer", () => {
  it("produces a UTF-8 encoded buffer from AAD", () => {
    const aad = constructAAD("user-abc");
    const buf = aadToBuffer(aad);
    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(buf.toString("utf-8"), "user-abc");
  });

  it("produces correct byte length for ASCII userId", () => {
    const aad = constructAAD("abc");
    const buf = aadToBuffer(aad);
    assert.strictEqual(buf.length, 3);
  });

  it("produces correct byte length for multi-byte userId", () => {
    const aad = constructAAD("üñîçødê");
    const buf = aadToBuffer(aad);
    assert.strictEqual(buf.length, Buffer.byteLength("üñîçødê", "utf-8"));
  });
});
