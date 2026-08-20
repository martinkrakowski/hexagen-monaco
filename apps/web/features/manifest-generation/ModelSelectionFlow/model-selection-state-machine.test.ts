import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
} from "./model-selection-state-machine";
import type {
  GenerateWithAiScreenState,
  ModelSelectionEvent,
} from "./model-selection-state-machine";

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
    const transitions: Array<{
      name: string;
      from: GenerateWithAiScreenState;
      event: ModelSelectionEvent;
      to: GenerateWithAiScreenState;
    }> = [
      {
        name: "SELECT_LOCAL_MODEL",
        from: "model_selection",
        event: {
          type: "SELECT_LOCAL_MODEL",
          modelId: "qwen-coder-3b" as DomainModelId,
          remember: false,
        },
        to: "model_downloading",
      },
      {
        name: "SELECT_CLOUD_PROVIDER",
        from: "model_selection",
        event: {
          type: "SELECT_CLOUD_PROVIDER",
          provider: "openai",
          apiKey: "sk-test",
          remember: false,
        },
        to: "key_validation",
      },
      {
        name: "SKIP_AI_SETUP",
        from: "idle",
        event: { type: "SKIP_AI_SETUP" },
        to: "idle",
      },
      {
        name: "CANCEL_DOWNLOAD",
        from: "model_downloading",
        event: { type: "CANCEL_DOWNLOAD" },
        to: "interrupted",
      },
      {
        name: "MODEL_READY",
        from: "model_downloading",
        event: { type: "MODEL_READY" },
        to: "generating",
      },
      {
        name: "MODEL_ERROR",
        from: "model_downloading",
        event: { type: "MODEL_ERROR", errorMessage: "test error" },
        to: "error",
      },
      {
        name: "SAVE_GENERATION_RESULT",
        from: "generating",
        event: {
          type: "SAVE_GENERATION_RESULT",
          manifest: "test manifest",
        },
        to: "preview",
      },
      {
        name: "REJECT_MANIFEST",
        from: "preview",
        event: { type: "REJECT_MANIFEST" },
        to: "model_selection",
      },
      {
        name: "PROCEED_TO_WIZARD",
        from: "preview",
        event: { type: "PROCEED_TO_WIZARD" },
        to: "wizard_hydration",
      },
    ];

    it.each(transitions)(
      "should transition to $to on $name",
      ({ from, event, to }) => {
        assert.strictEqual(transitionState(from, event), to);
      },
    );
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
