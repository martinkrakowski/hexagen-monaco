/**
 * Thinking-gate wiring: reasoning-default models (Qwen3 family) must be
 * initialized with disableThinking: true so the worker sends
 * extra_body.enable_thinking: false on every generate call.
 *
 * Why (local analog of baseline finding F1,
 * docs/planning/staged-generation-baseline-findings.md): thinking tokens
 * are billed against maxTokens caps and <think> blocks break
 * structured-output JSON parsing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WebLLMAdapter } from "../../../src/infrastructure/adapters/webllm.adapter.js";
import { DomainModelId } from "../../../src/domain/value-objects/model-id.vo.js";

/** Minimal Worker double: records postMessage payloads and answers the
 * "init" message with "ready" so initialize() resolves. */
class FakeWorker {
  posted: Array<{ type: string; data: Record<string, unknown> }> = [];
  private listeners: Array<(e: MessageEvent) => void> = [];

  addEventListener(_type: string, handler: (e: MessageEvent) => void): void {
    this.listeners.push(handler);
  }
  removeEventListener(_type: string, handler: (e: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((l) => l !== handler);
  }
  postMessage(msg: { type: string; data: Record<string, unknown> }): void {
    this.posted.push(msg);
    if (msg.type === "init") {
      queueMicrotask(() => {
        for (const l of [...this.listeners]) {
          l({ data: { type: "ready" } } as MessageEvent);
        }
      });
    }
  }
  terminate(): void {}
}

async function initPayloadFor(
  modelId: DomainModelId,
): Promise<Record<string, unknown>> {
  const worker = new FakeWorker();
  const adapter = new WebLLMAdapter({
    createWorker: () => worker as unknown as Worker,
  });
  const result = await adapter.initialize({ modelId }, () => {});
  assert.equal(result.success, true);
  const init = worker.posted.find((m) => m.type === "init");
  assert.ok(init, "init message posted");
  return init.data;
}

describe("WebLLMAdapter thinking gate (init wiring)", () => {
  it("reasoning-default model (Qwen3) → disableThinking: true", async () => {
    const data = await initPayloadFor(DomainModelId.QWEN3_4B);
    assert.equal(data.disableThinking, true);
  });

  it("non-reasoning model (Qwen2.5-Coder) → disableThinking: false", async () => {
    const data = await initPayloadFor(DomainModelId.QWEN_CODER_3B);
    assert.equal(data.disableThinking, false);
  });

  it("every Qwen3 catalog entry initializes with thinking disabled", async () => {
    for (const modelId of [
      DomainModelId.QWEN3_8B,
      DomainModelId.QWEN3_4B,
      DomainModelId.QWEN3_1_7B,
      DomainModelId.QWEN3_0_6B,
    ]) {
      const data = await initPayloadFor(modelId);
      assert.equal(
        data.disableThinking,
        true,
        `${modelId} must disable thinking`,
      );
    }
  });
});
