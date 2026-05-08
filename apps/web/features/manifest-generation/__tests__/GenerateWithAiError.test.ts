import { describe, it } from "node:test";
import assert from "node:assert";
import {
  GENERATE_WITH_AI_ERROR_MESSAGES,
  type GenerateWithAiErrorCode,
} from "../GenerateWithAi/GenerateWithAiError";

const ALL_ERROR_CODES: GenerateWithAiErrorCode[] = [
  "network_failure",
  "model_corrupted",
  "webgpu_unavailable",
  "key_invalid_format",
  "key_rejected",
  "inference_timeout",
  "inference_failed",
  "no_yaml_extracted",
  "yaml_validation_failed",
];

describe("GenerateWithAiError", () => {
  describe("GENERATE_WITH_AI_ERROR_MESSAGES", () => {
    it("should have entries for all error codes", () => {
      const recordedCodes = Object.keys(
        GENERATE_WITH_AI_ERROR_MESSAGES,
      ) as GenerateWithAiErrorCode[];

      for (const code of ALL_ERROR_CODES) {
        assert.ok(
          recordedCodes.includes(code),
          `Missing error message for code: ${code}`,
        );
      }

      const extraCodes = recordedCodes.filter(
        (c) => !ALL_ERROR_CODES.includes(c),
      );
      assert.strictEqual(
        extraCodes.length,
        0,
        `Unexpected extra codes in GENERATE_WITH_AI_ERROR_MESSAGES: ${extraCodes.join(", ")}`,
      );
    });

    it("should return non-empty strings for every error code", () => {
      for (const code of ALL_ERROR_CODES) {
        const message = GENERATE_WITH_AI_ERROR_MESSAGES[code];
        assert.ok(
          typeof message === "string" && message.trim().length > 0,
          `Error code "${code}" has empty or missing message`,
        );
      }
    });

    it("should return unique messages for each error code", () => {
      const messages = ALL_ERROR_CODES.map(
        (code) => GENERATE_WITH_AI_ERROR_MESSAGES[code],
      );
      const unique = new Set(messages);
      assert.strictEqual(
        unique.size,
        messages.length,
        "All error messages should be unique",
      );
    });
  });

  describe("GenerateWithAiErrorCode type", () => {
    it("should cover exactly 9 known error codes", () => {
      const codeCount = Object.keys(GENERATE_WITH_AI_ERROR_MESSAGES).length;
      assert.strictEqual(codeCount, 9, "Should have exactly 9 error codes");
      assert.strictEqual(
        ALL_ERROR_CODES.length,
        9,
        "Should have exactly 9 known codes",
      );
    });
  });
});
