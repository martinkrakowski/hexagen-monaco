import assert from "node:assert";
import { FakeLocalLLMProviderPort } from "../../doubles/ports/local-llm-provider.fake.js";
import { InitializeModelUseCase } from "../../../src/application/use-cases/initialize-model.use-case.js";

const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

(async () => {
  const fakeProvider = new FakeLocalLLMProviderPort({
    loadedModelMetadata: {
      modelId: MODEL_ID,
      vendor: "MLC AI",
      parameterSize: "3.8B",
      quantizeLevel: "q4f16_1",
      contextLength: 4096,
      vocabularySize: 32064,
      recommendedTemperature: 0.2,
      isLoaded: true,
    },
  });

  const useCase = new InitializeModelUseCase(fakeProvider);

  // 1️⃣ Happy path — initialize succeeds and returns model metadata
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
    `Expected success, got error: ${result.error?.message}`,
  );
  assert(progressCalled, "Expected onProgress to be called");
  assert(result.value?.initialized === true, "Expected initialized to be true");
  assert(
    result.value?.modelId === MODEL_ID,
    `Expected modelId '${MODEL_ID}', got '${result.value?.modelId}'`,
  );
  assert(
    result.value?.phase === "ready",
    `Expected phase 'ready', got '${result.value?.phase}'`,
  );
  console.log("✅ InitializeModelUseCase happy path");

  // 2️⃣ Provider initialize fails — returns error Result
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
  assert(
    failResult.error?.message === "WebGPU not available",
    `Expected WebGPU error, got: ${failResult.error?.message}`,
  );
  console.log("✅ InitializeModelUseCase propagates provider failure");

  // 3️⃣ Provider returns null metadata — returns error Result
  const noMetadataProvider = new FakeLocalLLMProviderPort({
    loadedModelMetadata: null,
  });
  const noMetaUseCase = new InitializeModelUseCase(noMetadataProvider);
  const noMetaResult = await noMetaUseCase.execute({
    config: { modelId: MODEL_ID },
    onProgress: () => {},
  });

  assert(!noMetaResult.success, "Expected failure result when no metadata");
  assert(
    noMetaResult.error?.message.includes("no metadata returned"),
    `Expected 'no metadata returned' error, got: ${noMetaResult.error?.message}`,
  );
  console.log("✅ InitializeModelUseCase handles null metadata");

  console.log("\n✅ All InitializeModelUseCase tests passed.");
})();
