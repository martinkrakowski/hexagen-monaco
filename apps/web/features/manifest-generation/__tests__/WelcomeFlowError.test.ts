import { describe, it } from "node:test";
import assert from "node:assert";
import {
  WELCOME_FLOW_ERROR_MESSAGES,
  type WelcomeFlowErrorCode,
} from "../ModelSelectionFlow/WelcomeFlowError";

const ALL_ERROR_CODES: WelcomeFlowErrorCode[] = [
  "network_failure",
  "model_corrupted",
  "webgpu_unavailable",
  "key_invalid_format",
  "key_rejected",
  "inference_timeout",
  "inference_failed",
  "no_yaml_extracted",
];

describe("WelcomeFlowError", () => {
  describe("WELCOME_FLOW_ERROR_MESSAGES", () => {
    it("should have entries for all error codes", () => {
      const recordedCodes = Object.keys(
        WELCOME_FLOW_ERROR_MESSAGES,
      ) as WelcomeFlowErrorCode[];

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
        `Unexpected extra codes in WELCOME_FLOW_ERROR_MESSAGES: ${extraCodes.join(", ")}`,
      );
    });

    it("should return non-empty strings for every error code", () => {
      for (const code of ALL_ERROR_CODES) {
        const message = WELCOME_FLOW_ERROR_MESSAGES[code];
        assert.ok(
          typeof message === "string" && message.trim().length > 0,
          `Error code "${code}" has empty or missing message`,
        );
      }
    });

    it("should return unique messages for each error code", () => {
      const messages = ALL_ERROR_CODES.map(
        (code) => WELCOME_FLOW_ERROR_MESSAGES[code],
      );
      const unique = new Set(messages);
      assert.strictEqual(
        unique.size,
        messages.length,
        "All error messages should be unique",
      );
    });
  });

  describe("WelcomeFlowErrorCode type", () => {
    it("should cover exactly 8 known error codes", () => {
      const codeCount = Object.keys(WELCOME_FLOW_ERROR_MESSAGES).length;
      assert.strictEqual(codeCount, 8, "Should have exactly 8 error codes");
      assert.strictEqual(ALL_ERROR_CODES.length, 8, "Should have exactly 8 known codes");
    });
  });
});