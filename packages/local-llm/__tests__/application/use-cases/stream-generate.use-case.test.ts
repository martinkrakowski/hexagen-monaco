import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeLocalLLMProviderPort } from "../../doubles/ports/local-llm-provider.fake.js";
import { StreamGenerateUseCase } from "../../../src/application/use-cases/stream-generate.use-case.js";
import { DomainModelId } from "../../../src/domain/value-objects/model-id.vo.js";
import { MODEL_METADATA_MAP } from "../../../src/domain/value-objects/model-metadata.vo.js";

const CHUNKS = ["Hello", " ", "world", "!"];
const MODEL_ID = DomainModelId.PHI3_MINI;

describe("stream-generate.use-case", () => {
  it("should yield all chunks in order", async () => {
    const happyProvider = new FakeLocalLLMProviderPort({
      streamChunks: CHUNKS,
      loadedModelMetadata: MODEL_METADATA_MAP[MODEL_ID],
    });
    const happyUseCase = new StreamGenerateUseCase(happyProvider);
    const collected: string[] = [];

    for await (const result of happyUseCase.execute({
      request: {
        modelId: MODEL_ID,
        messages: [{ role: "user", content: "Hello" }],
      },
    })) {
      assert(
        result.success,
        `Unexpected error: ${result.success === false && result.error instanceof Error ? result.error.message : "unknown"}`,
      );
      collected.push(result.value!);
    }

    assert(
      collected.join("") === CHUNKS.join(""),
      `Expected '${CHUNKS.join("")}', got '${collected.join("")}'`,
    );
  });

  it("should propagate stream error", async () => {
    const errorProvider = new FakeLocalLLMProviderPort({
      streamError: new Error("Worker terminated unexpectedly"),
    });
    const errorUseCase = new StreamGenerateUseCase(errorProvider);

    let errorReceived = false;
    for await (const result of errorUseCase.execute({
      request: {
        modelId: MODEL_ID,
        messages: [{ role: "user", content: "Hello" }],
      },
    })) {
      assert(!result.success, "Expected error result");
      if (!result.success) {
        assert(
          result.error instanceof Error &&
            result.error.message === "Worker terminated unexpectedly",
          `Expected 'Worker terminated unexpectedly', got: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
        );
      }
      errorReceived = true;
    }
    assert(errorReceived, "Expected at least one error result");
  });

  it("should handle empty chunks", async () => {
    const emptyProvider = new FakeLocalLLMProviderPort({ streamChunks: [] });
    const emptyUseCase = new StreamGenerateUseCase(emptyProvider);
    let yieldCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _unused of emptyUseCase.execute({
      request: {
        modelId: MODEL_ID,
        messages: [{ role: "user", content: "Hello" }],
      },
    })) {
      yieldCount++;
    }

    assert(yieldCount === 0, `Expected 0 yields, got ${yieldCount}`);
  });

  it("should handle disposed provider", async () => {
    const disposedProvider = new FakeLocalLLMProviderPort();
    disposedProvider.dispose();
    const disposedUseCase = new StreamGenerateUseCase(disposedProvider);
    let disposedErrorReceived = false;

    for await (const result of disposedUseCase.execute({
      request: {
        modelId: MODEL_ID,
        messages: [{ role: "user", content: "Hello" }],
      },
    })) {
      assert(!result.success, "Expected error result for disposed provider");
      disposedErrorReceived = true;
    }
    assert(
      disposedErrorReceived,
      "Expected error result for disposed provider",
    );
  });
});
