import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateApiKeyFormat } from "../../src/domain/services/api-key-format-validator.js";

describe("validateApiKeyFormat", () => {
  it("accepts a valid OpenAI key (sk- + 32+ alphanumeric)", () => {
    const result = validateApiKeyFormat(
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "openai",
    );
    assert.strictEqual(result.success, true);
  });

  it("accepts a valid Anthropic key (sk-ant- + 32+ alphanumeric/dash)", () => {
    const result = validateApiKeyFormat(
      "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890abcd",
      "anthropic",
    );
    assert.strictEqual(result.success, true);
  });

  it("accepts a valid Cohere key (40 alphanumeric)", () => {
    const result = validateApiKeyFormat(
      "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      "cohere",
    );
    assert.strictEqual(result.success, true);
  });

  it("rejects an OpenAI key that is too short", () => {
    const result = validateApiKeyFormat("sk-abc", "openai");
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_key_format");
      assert.strictEqual(result.error.provider, "openai");
    }
  });

  it("rejects an Anthropic key with wrong prefix", () => {
    const result = validateApiKeyFormat(
      "sk-wrong-abcdefghijklmnopqrstuvwxyz1234567890",
      "anthropic",
    );
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_key_format");
      assert.strictEqual(result.error.provider, "anthropic");
    }
  });

  it("rejects a Cohere key that is too short", () => {
    const result = validateApiKeyFormat("shortkey123", "cohere");
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_key_format");
      assert.strictEqual(result.error.provider, "cohere");
    }
  });

  it("rejects an empty string for OpenAI", () => {
    const result = validateApiKeyFormat("", "openai");
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_key_format");
    }
  });

  it("rejects an empty string for Anthropic", () => {
    const result = validateApiKeyFormat("", "anthropic");
    assert.strictEqual(result.success, false);
  });

  it("rejects an empty string for Cohere", () => {
    const result = validateApiKeyFormat("", "cohere");
    assert.strictEqual(result.success, false);
  });

  it("rejects an OpenAI key with special characters", () => {
    const result = validateApiKeyFormat(
      "sk-abc!defghijklmnopqrstuvwxyz123456",
      "openai",
    );
    assert.strictEqual(result.success, false);
  });

  it("rejects a Cohere key with dashes", () => {
    const result = validateApiKeyFormat(
      "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890",
      "cohere",
    );
    assert.strictEqual(result.success, false);
  });
});
