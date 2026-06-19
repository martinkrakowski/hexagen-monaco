import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
} from "../../src/domain/services/model-selection-state-machine";
import type { ModelSelectionEvent } from "../../src/domain/services/model-selection-state-machine";

type DomainModelId =
  | "qwen-coder-3b"
  | "llama-3.2-3b"
  | "qwen3-8b"
  | "qwen3-4b"
  | "qwen3-1.7b"
  | "qwen3-0.6b"
  | "qwen-coder-1.5b"
  | "llama-3.2-1b"
  | "qwen-coder-0.5b";

describe("ModelSelectionStateMachine", () => {
  describe("getInitialState", () => {
    it("should return idle as initial state", () => {
      assert.strictEqual(getInitialState(), "idle");
    });
  });

  describe("transitionState", () => {
    it("should transition to model_downloading on SELECT_LOCAL_MODEL", () => {
      const event: ModelSelectionEvent = {
        type: "SELECT_LOCAL_MODEL",
        modelId: "qwen-coder-3b" as DomainModelId,
        remember: false,
      };
      const result = transitionState("model_selection", event);
      assert.strictEqual(result, "model_downloading");
    });

    it("should transition to key_validation on SELECT_CLOUD_PROVIDER", () => {
      const event: ModelSelectionEvent = {
        type: "SELECT_CLOUD_PROVIDER",
        provider: "openai",
        apiKey: "sk-test",
        remember: false,
      };
      const result = transitionState("model_selection", event);
      assert.strictEqual(result, "key_validation");
    });

    it("should transition to idle on SKIP_AI_SETUP", () => {
      const event: ModelSelectionEvent = { type: "SKIP_AI_SETUP" };
      const result = transitionState("idle", event);
      assert.strictEqual(result, "idle");
    });

    it("should transition to interrupted on CANCEL_DOWNLOAD", () => {
      const event: ModelSelectionEvent = { type: "CANCEL_DOWNLOAD" };
      const result = transitionState("model_downloading", event);
      assert.strictEqual(result, "interrupted");
    });

    it("should transition to generating on MODEL_READY", () => {
      const event: ModelSelectionEvent = { type: "MODEL_READY" };
      const result = transitionState("model_downloading", event);
      assert.strictEqual(result, "generating");
    });

    it("should transition to error on MODEL_ERROR", () => {
      const event: ModelSelectionEvent = {
        type: "MODEL_ERROR",
        errorMessage: "test error",
      };
      const result = transitionState("model_downloading", event);
      assert.strictEqual(result, "error");
    });

    it("should transition to preview on SAVE_GENERATION_RESULT", () => {
      const event: ModelSelectionEvent = {
        type: "SAVE_GENERATION_RESULT",
        manifest: "test manifest",
      };
      const result = transitionState("generating", event);
      assert.strictEqual(result, "preview");
    });

    it("should transition to model_selection on REJECT_MANIFEST", () => {
      const event: ModelSelectionEvent = { type: "REJECT_MANIFEST" };
      const result = transitionState("preview", event);
      assert.strictEqual(result, "model_selection");
    });

    it("should transition to wizard_hydration on PROCEED_TO_WIZARD", () => {
      const event: ModelSelectionEvent = { type: "PROCEED_TO_WIZARD" };
      const result = transitionState("preview", event);
      assert.strictEqual(result, "wizard_hydration");
    });
  });

  describe("canTransition", () => {
    it("should allow valid transitions", () => {
      assert.strictEqual(
        canTransition("model_selection", "model_downloading"),
        true,
      );
    });

    it("should reject invalid transitions", () => {
      assert.strictEqual(canTransition("idle", "preview"), false);
    });

    it("should allow transition from error to idle", () => {
      assert.strictEqual(canTransition("error", "idle"), true);
    });

    it("should allow transition from error to model_selection", () => {
      assert.strictEqual(canTransition("error", "model_selection"), true);
    });
  });

  describe("isTerminalState", () => {
    it("should return true for wizard_hydration", () => {
      assert.strictEqual(isTerminalState("wizard_hydration"), true);
    });

    it("should return false for other states", () => {
      assert.strictEqual(isTerminalState("idle"), false);
      assert.strictEqual(isTerminalState("generating"), false);
    });
  });

  describe("isBlockingState", () => {
    it("should return true for blocking states", () => {
      assert.strictEqual(isBlockingState("model_downloading"), true);
      assert.strictEqual(isBlockingState("key_validation"), true);
      assert.strictEqual(isBlockingState("generating"), true);
    });

    it("should return false for non-blocking states", () => {
      assert.strictEqual(isBlockingState("idle"), false);
      assert.strictEqual(isBlockingState("preview"), false);
    });
  });
});
