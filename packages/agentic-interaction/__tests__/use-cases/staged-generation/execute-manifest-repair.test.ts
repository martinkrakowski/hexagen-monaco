import { test, describe } from "node:test";
import assert from "node:assert";
import { ExecuteManifestRepairUseCase } from "../../../src/application/use-cases/staged-generation/execute-manifest-repair.use-case.ts";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { StageMaxRetriesError } from "../../../src/domain/errors/stage-errors";
import type { StageTelemetry } from "../../../src/domain/value-objects/stage-telemetry";

function createMockReviewerPort(
  streamFn: () => AsyncIterable<{
    success: boolean;
    value?: string;
    error?: unknown;
  }>,
  resolvedModel?: string,
): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true as const, value: {} }),
    streamStructuredRequest: (request: {
      onModelResolved?: (i: unknown) => void;
    }) => {
      if (resolvedModel && request?.onModelResolved) {
        request.onModelResolved({ model: resolvedModel });
      }
      return streamFn();
    },
  } as unknown as SendStructuredRequestPort;
}

async function* successStream(content: string) {
  yield { success: true, value: content };
}
async function* errorStream(error: unknown) {
  yield { success: false, error };
}

const report = {
  errors: ["[R01] Context 'payment-gateway' violates R01: banned token."],
  warnings: ["[R16] billing/ChargePort: weak description"],
};
const correctedConfig = "bounded_contexts:\n  - name: billing\n";

describe("ExecuteManifestRepairUseCase", () => {
  test("returns the corrected config text from the reviewer stream", async () => {
    const port = createMockReviewerPort(() => successStream(correctedConfig));
    const useCase = new ExecuteManifestRepairUseCase(port);
    const result = await useCase.execute(
      "bounded_contexts:\n  - name: payment-gateway\n",
      report,
    );
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value, correctedConfig.trim());
    }
  });

  test("strips markdown code fences the model may wrap the config in", async () => {
    const fenced = "```yaml\n" + correctedConfig + "```\n";
    const port = createMockReviewerPort(() => successStream(fenced));
    const useCase = new ExecuteManifestRepairUseCase(port);
    const result = await useCase.execute("x", report);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(!result.value.includes("```"));
      assert.match(result.value, /bounded_contexts/);
    }
  });

  test("emits Stage-7 telemetry carrying the served model name", async () => {
    const telemetry: StageTelemetry[] = [];
    const port = createMockReviewerPort(
      () => successStream(correctedConfig),
      "openai/gpt-4o",
    );
    const useCase = new ExecuteManifestRepairUseCase(port);
    await useCase.execute("x", report, undefined, (t) => telemetry.push(t));
    assert.strictEqual(telemetry.length, 1);
    assert.strictEqual(telemetry[0].stage, 7);
    assert.strictEqual(telemetry[0].label, "Manifest Repair");
    assert.strictEqual(telemetry[0].usedLLM, true);
    assert.strictEqual(telemetry[0].modelName, "openai/gpt-4o");
  });

  test("fails when the reviewer stream errors", async () => {
    const port = createMockReviewerPort(() =>
      errorStream(new Error("reviewer down")),
    );
    const useCase = new ExecuteManifestRepairUseCase(port);
    const result = await useCase.execute("x", report);
    assert.strictEqual(result.success, false);
  });

  test("fails (StageMaxRetriesError) when the repair output is empty", async () => {
    const port = createMockReviewerPort(() => successStream("```\n```\n"));
    const useCase = new ExecuteManifestRepairUseCase(port);
    const result = await useCase.execute("x", report);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });
});
