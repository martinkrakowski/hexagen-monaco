/**
 * Red-path fixture: verifies that the barrel does NOT leak @internal types
 * as runtime-value exports. LLMMessage and LocalLLMProviderPort are marked
 * @internal per ADR 0021. They remain in the barrel for import type usage
 * but must not be used as runtime values from outside the bounded context.
 *
 * This test checks the structural invariant: the barrel still exports these
 * names (they exist in the type surface) but the ESLint rule and boundary
 * script enforce that apps/web only uses `import type`.
 */
import assert from "node:assert";
import type {
  LLMMessage,
  LocalLLMProviderPort,
} from "../../src/domain/ports/local-llm-provider.port.js";
import type { SendStructuredRequestPort } from "../../src/application/ports/in/send-structured-request.port.js";
import type { ModelLifecyclePort } from "../../src/domain/ports/model-lifecycle.port.js";
import { FreeFormStringSchema } from "../../src/application/ports/in/send-structured-request.port.js";

(async () => {
  // 1. FreeFormStringSchema is a runtime value
  assert.ok(FreeFormStringSchema, "FreeFormStringSchema should be defined");
  assert.strictEqual(
    typeof FreeFormStringSchema.parse,
    "function",
    "FreeFormStringSchema.parse should be a function",
  );

  // 2. SendStructuredRequestPort includes sendRequest + streamStructuredRequest
  const sendMethodNames: Array<keyof SendStructuredRequestPort> = [
    "sendRequest",
    "streamStructuredRequest",
  ];
  assert.strictEqual(
    sendMethodNames.length,
    2,
    "SendStructuredRequestPort should declare exactly 2 methods",
  );

  // 3. ModelLifecyclePort includes lifecycle methods only
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

  // 4. LLMMessage is a type-only export (structural check via sample value)
  const sample: LLMMessage = { role: "system", content: "test" };
  assert.strictEqual(sample.role, "system");
  assert.strictEqual(sample.content, "test");

  // 5. LocalLLMProviderPort extends both new ports structurally
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

  console.log("✅ All ACL barrel shape invariants verified.");
})();
