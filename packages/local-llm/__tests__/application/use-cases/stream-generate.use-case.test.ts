import assert from "node:assert";
import { FakeLocalLLMProviderPort } from "../../doubles/ports/local-llm-provider.fake.js";
import { StreamGenerateUseCase } from "../../../src/application/use-cases/stream-generate.use-case.js";

const CHUNKS = ["Hello", " ", "world", "!"];
const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

(async () => {
  // 1️⃣ Happy path — yields all chunks in order
  const happyProvider = new FakeLocalLLMProviderPort({
    streamChunks: CHUNKS,
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
  const happyUseCase = new StreamGenerateUseCase(happyProvider);
  const collected: string[] = [];

  for await (const result of happyUseCase.execute({
    request: {
      model: MODEL_ID,
      messages: [{ role: "user", content: "Hello" }],
    },
  })) {
    assert(result.success, `Unexpected error: ${result.error?.message}`);
    collected.push(result.value!);
  }

  assert(
    collected.join("") === CHUNKS.join(""),
    `Expected '${CHUNKS.join("")}', got '${collected.join("")}'`,
  );
  console.log("✅ StreamGenerateUseCase yields all chunks in order");

  // 2️⃣ Provider throws stream error — yields error Result
  const errorProvider = new FakeLocalLLMProviderPort({
    streamError: new Error("Worker terminated unexpectedly"),
  });
  const errorUseCase = new StreamGenerateUseCase(errorProvider);

  let errorReceived = false;
  for await (const result of errorUseCase.execute({
    request: {
      model: MODEL_ID,
      messages: [{ role: "user", content: "Hello" }],
    },
  })) {
    assert(!result.success, "Expected error result");
    assert(
      result.error?.message === "Worker terminated unexpectedly",
      `Expected 'Worker terminated unexpectedly', got: ${result.error?.message}`,
    );
    errorReceived = true;
  }
  assert(errorReceived, "Expected at least one error result");
  console.log("✅ StreamGenerateUseCase propagates stream error");

  // 3️⃣ Empty chunks — yields nothing
  const emptyProvider = new FakeLocalLLMProviderPort({ streamChunks: [] });
  const emptyUseCase = new StreamGenerateUseCase(emptyProvider);
  let yieldCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _unused of emptyUseCase.execute({
    request: {
      model: MODEL_ID,
      messages: [{ role: "user", content: "Hello" }],
    },
  })) {
    yieldCount++;
  }

  assert(yieldCount === 0, `Expected 0 yields, got ${yieldCount}`);
  console.log("✅ StreamGenerateUseCase handles empty chunks");

  // 4️⃣ Provider is disposed — yields error Result immediately
  const disposedProvider = new FakeLocalLLMProviderPort();
  disposedProvider.dispose();
  const disposedUseCase = new StreamGenerateUseCase(disposedProvider);
  let disposedErrorReceived = false;

  for await (const result of disposedUseCase.execute({
    request: {
      model: MODEL_ID,
      messages: [{ role: "user", content: "Hello" }],
    },
  })) {
    assert(!result.success, "Expected error result for disposed provider");
    disposedErrorReceived = true;
  }
  assert(disposedErrorReceived, "Expected error result for disposed provider");
  console.log("✅ StreamGenerateUseCase handles disposed provider");

  console.log("\n✅ All StreamGenerateUseCase tests passed.");
})();
