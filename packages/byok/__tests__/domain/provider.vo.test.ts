import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isByokProvider } from "../../src/domain/value-objects/provider.vo.js";

describe("isByokProvider", () => {
  it("returns true for 'openai'", () => {
    assert.strictEqual(isByokProvider("openai"), true);
  });

  it("returns true for 'anthropic'", () => {
    assert.strictEqual(isByokProvider("anthropic"), true);
  });

  it("returns true for 'cohere'", () => {
    assert.strictEqual(isByokProvider("cohere"), true);
  });

  it("returns false for an invalid string", () => {
    assert.strictEqual(isByokProvider("google"), false);
  });

  it("returns false for an empty string", () => {
    assert.strictEqual(isByokProvider(""), false);
  });

  it("returns false for a near-match string", () => {
    assert.strictEqual(isByokProvider("openai "), false);
  });

  it("narrows the type when returning true", () => {
    const value: string = "openai";
    if (isByokProvider(value)) {
      const provider: "openai" | "anthropic" | "cohere" = value;
      assert.strictEqual(provider, "openai");
    }
  });
});
