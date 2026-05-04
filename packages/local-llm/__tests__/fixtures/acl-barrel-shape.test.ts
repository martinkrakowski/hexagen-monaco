import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  LLMMessage,
  LocalLLMProviderPort,
} from "../../src/domain/ports/local-llm-provider.port.js";
import type { SendStructuredRequestPort } from "../../src/application/ports/in/send-structured-request.port.js";
import type { ModelLifecyclePort } from "../../src/domain/ports/model-lifecycle.port.js";
import { FreeFormStringSchema } from "../../src/application/ports/in/send-structured-request.port.js";

describe("acl-barrel-shape", () => {
  it("should have FreeFormStringSchema as a runtime value", () => {
    assert.ok(FreeFormStringSchema, "FreeFormStringSchema should be defined");
    assert.strictEqual(
      typeof FreeFormStringSchema.parse,
      "function",
      "FreeFormStringSchema.parse should be a function",
    );
  });

  it("should have SendStructuredRequestPort with 2 methods", () => {
    const sendMethodNames: Array<keyof SendStructuredRequestPort> = [
      "sendRequest",
      "streamStructuredRequest",
    ];
    assert.strictEqual(
      sendMethodNames.length,
      2,
      "SendStructuredRequestPort should declare exactly 2 methods",
    );
  });

  it("should have ModelLifecyclePort with 5 lifecycle methods", () => {
    const lifecycleMethodNames: Array<keyof ModelLifecyclePort> = [
      "initialize",
      "getLoadedModel",
      "hasModelInCache",
      "deleteCachedModel",
      "dispose",
    ];
    assert.strictEqual(
      lifecycleMethodNames.length,
      5,
      "ModelLifecyclePort should declare exactly 5 lifecycle methods",
    );
  });

  it("should export LLMMessage as a type-only export", () => {
    const sample: LLMMessage = { role: "system", content: "test" };
    assert.strictEqual(sample.role, "system");
    assert.strictEqual(sample.content, "test");
  });

  it("should have LocalLLMProviderPort retain legacy methods", () => {
    const legacyMethods: Array<keyof LocalLLMProviderPort> = [
      "initialize",
      "complete",
      "streamComplete",
      "getLoadedModel",
      "hasModelInCache",
      "deleteCachedModel",
      "dispose",
    ];
    assert.ok(
      legacyMethods.includes("complete"),
      "LocalLLMProviderPort should retain legacy 'complete' method",
    );
    assert.ok(
      legacyMethods.includes("streamComplete"),
      "LocalLLMProviderPort should retain legacy 'streamComplete' method",
    );
  });
});
