import { describe, it } from "vitest";
import assert from "node:assert";
import { FakeLocalLLMProviderPort } from "../../doubles/ports/local-llm-provider.fake.js";
import { InitializeModelUseCase } from "../../../src/application/use-cases/initialize-model.use-case.js";
import { DomainModelId } from "../../../src/domain/value-objects/model-id.vo.js";
import { MODEL_METADATA_MAP } from "../../../src/domain/value-objects/model-metadata.vo.js";

const MODEL_ID = DomainModelId.QWEN3_4B;

describe("initialize-model.use-case", () => {
  it("should initialize model and call onProgress", async () => {
    const fakeProvider = new FakeLocalLLMProviderPort({
      loadedModelMetadata: MODEL_METADATA_MAP[MODEL_ID],
    });

    const useCase = new InitializeModelUseCase(fakeProvider);

    let progressCalled = false;
    const result = await useCase.execute({
      config: { modelId: MODEL_ID },
      onProgress: (progress) => {
        progressCalled = true;
        assert(
          progress.phase === "ready",
          `Expected phase 'ready', got '${progress.phase}'`,
        );
      },
    });

    assert(
      result.success,
      `Expected success, got error: ${result.success === false && result.error instanceof Error ? result.error.message : "unknown"}`,
    );
    assert(progressCalled, "Expected onProgress to be called");
    assert(
      result.value.initialized === true,
      "Expected initialized to be true",
    );
    assert(
      result.value.modelId === MODEL_ID,
      `Expected modelId '${MODEL_ID}', got '${result.value.modelId}'`,
    );
    assert(
      result.value.phase === "ready",
      `Expected phase 'ready', got '${result.value.phase}'`,
    );
  });

  it("should propagate provider failure", async () => {
    const failingProvider = new FakeLocalLLMProviderPort({
      initializeResult: {
        success: false,
        error: new Error("WebGPU not available"),
      },
    });
    const failingUseCase = new InitializeModelUseCase(failingProvider);
    const failResult = await failingUseCase.execute({
      config: { modelId: MODEL_ID },
      onProgress: () => {},
    });

    assert(!failResult.success, "Expected failure result");
    if (!failResult.success) {
      assert(
        failResult.error instanceof Error &&
          failResult.error.message === "WebGPU not available",
        `Expected WebGPU error, got: ${failResult.error instanceof Error ? failResult.error.message : String(failResult.error)}`,
      );
    }
  });

  it("should handle null metadata", async () => {
    const noMetadataProvider = new FakeLocalLLMProviderPort({
      loadedModelMetadata: null,
    });
    const noMetaUseCase = new InitializeModelUseCase(noMetadataProvider);
    const noMetaResult = await noMetaUseCase.execute({
      config: { modelId: MODEL_ID },
      onProgress: () => {},
    });

    assert(!noMetaResult.success, "Expected failure result when no metadata");
    if (!noMetaResult.success) {
      assert(
        noMetaResult.error instanceof Error &&
          noMetaResult.error.message.includes("no metadata returned"),
        `Expected 'no metadata returned' error, got: ${noMetaResult.error instanceof Error ? noMetaResult.error.message : String(noMetaResult.error)}`,
      );
    }
  });
});
