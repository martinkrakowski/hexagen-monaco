import { describe, it, expect } from "node:test";
import {
  transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
} from "../../src/domain/services/model-selection-state-machine";
import type { ModelSelectionEvent } from "../../src/domain/services/model-selection-state-machine";

type DomainModelId = "qwen-coder-3b" | "llama-3.2-3b" | "phi-3.5-mini" | "gemma-2-2b" | "qwen-coder-1.5b" | "llama-3.2-1b" | "qwen-coder-0.5b";

describe("ModelSelectionStateMachine", () => {
  describe("getInitialState", () => {
    it("should return idle as initial state", () => {
      expect(getInitialState()).toBe("idle");
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
      expect(result).toBe("model_downloading");
    });

    it("should transition to key_validation on SELECT_CLOUD_PROVIDER", () => {
      const event: ModelSelectionEvent = {
        type: "SELECT_CLOUD_PROVIDER",
        provider: "openai",
        apiKey: "sk-test",
        remember: false,
      };
      const result = transitionState("model_selection", event);
      expect(result).toBe("key_validation");
    });

    it("should transition to idle on SKIP_AI_SETUP", () => {
      const event: ModelSelectionEvent = { type: "SKIP_AI_SETUP" };
      const result = transitionState("idle", event);
      expect(result).toBe("idle");
    });

    it("should transition to interrupted on CANCEL_DOWNLOAD", () => {
      const event: ModelSelectionEvent = { type: "CANCEL_DOWNLOAD" };
      const result = transitionState("model_downloading", event);
      expect(result).toBe("interrupted");
    });

    it("should transition to generating on MODEL_READY", () => {
      const event: ModelSelectionEvent = { type: "MODEL_READY" };
      const result = transitionState("model_downloading", event);
      expect(result).toBe("generating");
    });

    it("should transition to error on MODEL_ERROR", () => {
      const event: ModelSelectionEvent = {
        type: "MODEL_ERROR",
        errorMessage: "test error",
      };
      const result = transitionState("model_downloading", event);
      expect(result).toBe("error");
    });

    it("should transition to preview on SAVE_GENERATION_RESULT", () => {
      const event: ModelSelectionEvent = {
        type: "SAVE_GENERATION_RESULT",
        manifest: "test manifest",
      };
      const result = transitionState("generating", event);
      expect(result).toBe("preview");
    });

    it("should transition to model_selection on REJECT_MANIFEST", () => {
      const event: ModelSelectionEvent = { type: "REJECT_MANIFEST" };
      const result = transitionState("preview", event);
      expect(result).toBe("model_selection");
    });

    it("should transition to wizard_hydration on PROCEED_TO_WIZARD", () => {
      const event: ModelSelectionEvent = { type: "PROCEED_TO_WIZARD" };
      const result = transitionState("preview", event);
      expect(result).toBe("wizard_hydration");
    });
  });

  describe("canTransition", () => {
    it("should allow valid transitions", () => {
      expect(canTransition("model_selection", "model_downloading")).toBe(true);
    });

    it("should reject invalid transitions", () => {
      expect(canTransition("idle", "preview")).toBe(false);
    });

    it("should allow transition from error to idle", () => {
      expect(canTransition("error", "idle")).toBe(true);
    });

    it("should allow transition from error to model_selection", () => {
      expect(canTransition("error", "model_selection")).toBe(true);
    });
  });

  describe("isTerminalState", () => {
    it("should return true for wizard_hydration", () => {
      expect(isTerminalState("wizard_hydration")).toBe(true);
    });

    it("should return false for other states", () => {
      expect(isTerminalState("idle")).toBe(false);
      expect(isTerminalState("generating")).toBe(false);
    });
  });

  describe("isBlockingState", () => {
    it("should return true for blocking states", () => {
      expect(isBlockingState("model_downloading")).toBe(true);
      expect(isBlockingState("key_validation")).toBe(true);
      expect(isBlockingState("generating")).toBe(true);
    });

    it("should return false for non-blocking states", () => {
      expect(isBlockingState("idle")).toBe(false);
      expect(isBlockingState("preview")).toBe(false);
    });
  });
});