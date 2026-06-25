import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  FORBIDDEN_TOKENS,
  isForbiddenToken,
} from "../src/types/forbidden-brand";

describe("ForbiddenToken helpers", () => {
  it("FORBIDDEN_TOKENS includes all 11 forbidden prop names", () => {
    assert.strictEqual(FORBIDDEN_TOKENS.length, 11);
    assert.ok(FORBIDDEN_TOKENS.includes("data"));
    assert.ok(FORBIDDEN_TOKENS.includes("loading"));
    assert.ok(FORBIDDEN_TOKENS.includes("error"));
    assert.ok(FORBIDDEN_TOKENS.includes("result"));
    assert.ok(FORBIDDEN_TOKENS.includes("isFetching"));
    assert.ok(FORBIDDEN_TOKENS.includes("governance"));
    assert.ok(FORBIDDEN_TOKENS.includes("llm"));
    assert.ok(FORBIDDEN_TOKENS.includes("status"));
    assert.ok(FORBIDDEN_TOKENS.includes("isPending"));
    assert.ok(FORBIDDEN_TOKENS.includes("isSuccess"));
    assert.ok(FORBIDDEN_TOKENS.includes("isError"));
  });

  it("isForbiddenToken narrows string to ForbiddenToken", () => {
    assert.strictEqual(isForbiddenToken("data"), true);
    assert.strictEqual(isForbiddenToken("label"), false);
    assert.strictEqual(isForbiddenToken("variant"), false);
    assert.strictEqual(isForbiddenToken("onClick"), false);
  });
});
