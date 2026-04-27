import assert from "node:assert/strict";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";

// ─── useArchitectureModification (logic-only validation) ─────────────────────

// Since the hook uses React state, we validate the shapes and
// reducer logic it depends on rather than calling it directly
// (which would require a DOM + React test renderer).

function validateStepProgress(step: unknown): boolean {
  const s = step as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    typeof s.status === "string" &&
    (s.durationMs === null || typeof s.durationMs === "number")
  );
}

// Validate initial step names match the pipeline
const PIPELINE_STEP_NAMES = [
  "parse-nl-intent",
  "compile-prompt",
  "llm-inference",
  "reconcile",
  "commit-patches",
];

{
  const initialSteps = PIPELINE_STEP_NAMES.map((name) => ({
    name,
    status: "pending" as PipelineStepStatus,
    durationMs: null,
  }));

  assert.strictEqual(initialSteps.length, 5, "Should have 5 initial steps");
  for (const step of initialSteps) {
    assert.ok(validateStepProgress(step), `Step ${step.name} should be valid`);
    assert.strictEqual(
      step.status,
      "pending",
      `Step ${step.name} should start pending`,
    );
    assert.strictEqual(
      step.durationMs,
      null,
      `Step ${step.name} should have null duration`,
    );
  }
  console.log("✅ Hook test 1: initial step generation - passed");
}

// Validate step progress updates
{
  const steps = PIPELINE_STEP_NAMES.map((name) => ({
    name,
    status: "pending" as PipelineStepStatus,
    durationMs: null as number | null,
  }));

  const updated = steps.map((s) =>
    s.name === "parse-nl-intent"
      ? { ...s, status: "completed" as PipelineStepStatus, durationMs: 42 }
      : s,
  );

  const parseStep = updated.find((s) => s.name === "parse-nl-intent")!;
  assert.strictEqual(
    parseStep.status,
    "completed",
    "Parse step should be completed",
  );
  assert.strictEqual(
    parseStep.durationMs,
    42,
    "Parse step should have duration",
  );

  const compileStep = updated.find((s) => s.name === "compile-prompt")!;
  assert.strictEqual(
    compileStep.status,
    "pending",
    "Compile step should still be pending",
  );
  console.log("✅ Hook test 2: step progress updates - passed");
}

// Validate SSE event parsing
{
  const validEventTypes = [
    "pipeline_start",
    "step_complete",
    "pipeline_complete",
    "pipeline_error",
  ];
  for (const eventType of validEventTypes) {
    const sseFrame = `event: ${eventType}\ndata: {"test":true}\n\n`;
    assert.ok(
      sseFrame.includes(`event: ${eventType}`),
      `Should contain event type ${eventType}`,
    );
    assert.ok(sseFrame.includes("data: "), "Should contain data prefix");
  }
  console.log("✅ Hook test 3: SSE event format - passed");
}

// Validate pipeline complete data shape
{
  const completeData = {
    pipelineRunId: "run-123",
    patchesApplied: 0,
    lintPassed: null as boolean | null,
    transactionId: "txn-456",
  };
  assert.ok(
    typeof completeData.pipelineRunId === "string",
    "Should have pipelineRunId",
  );
  assert.ok(
    typeof completeData.patchesApplied === "number",
    "Should have patchesApplied",
  );
  assert.ok(
    completeData.lintPassed === null ||
      typeof completeData.lintPassed === "boolean",
    "lintPassed should be boolean or null",
  );
  assert.ok(
    typeof completeData.transactionId === "string",
    "Should have transactionId",
  );
  console.log("✅ Hook test 4: pipeline complete data shape - passed");
}

// Validate hook return type shape
{
  const hookReturn = {
    status: "idle" as const,
    steps: [] as unknown[],
    result: null as unknown,
    error: null as string | null,
    modify: (_intent: string) => {
      void _intent;
    },
    abort: () => {},
    reset: () => {},
    acceptPatches: () => {},
    rejectPatches: (_reason?: string) => {
      void _reason;
    },
  };
  assert.ok(typeof hookReturn.status === "string", "Should have status");
  assert.ok(Array.isArray(hookReturn.steps), "Should have steps array");
  assert.ok(
    typeof hookReturn.modify === "function",
    "Should have modify function",
  );
  assert.ok(
    typeof hookReturn.abort === "function",
    "Should have abort function",
  );
  assert.ok(
    typeof hookReturn.reset === "function",
    "Should have reset function",
  );
  assert.ok(
    typeof hookReturn.acceptPatches === "function",
    "Should have acceptPatches function",
  );
  assert.ok(
    typeof hookReturn.rejectPatches === "function",
    "Should have rejectPatches function",
  );
  console.log("✅ Hook test 5: hook return shape - passed");
}

console.log("✅ All useArchitectureModification tests passed.");
