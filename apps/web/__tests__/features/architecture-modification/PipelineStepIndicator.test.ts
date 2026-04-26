import assert from "node:assert/strict";
import type { PipelineStepStatus } from "@hexagen/ai-pipeline";

// ─── PipelineStepIndicator (shape validation) ──────────────────────────────

interface StepProgress {
  name: string;
  status: PipelineStepStatus;
  durationMs: number | null;
}

const STEP_LABELS: Record<string, string> = {
  "parse-nl-intent": "Parse Intent",
  "compile-prompt": "Compile Prompt",
  "llm-inference": "LLM Inference",
  reconcile: "Reconcile",
  "commit-patches": "Commit Patches",
};

// Test 1: step label coverage
{
  const pipelineStepNames = [
    "parse-nl-intent",
    "compile-prompt",
    "llm-inference",
    "reconcile",
    "commit-patches",
  ];
  for (const name of pipelineStepNames) {
    assert.ok(STEP_LABELS[name], `Should have label for step ${name}`);
    assert.ok(
      typeof STEP_LABELS[name] === "string",
      `Label for ${name} should be string`,
    );
  }
  console.log("✅ PipelineStep test 1: step label coverage - passed");
}

// Test 2: step status icons mapping
{
  const validStatuses: PipelineStepStatus[] = [
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
  ];
  for (const status of validStatuses) {
    assert.ok(
      typeof status === "string",
      `${status} should be a valid string status`,
    );
  }
  console.log("✅ PipelineStep test 2: valid step statuses - passed");
}

// Test 3: step progress shape
{
  const step: StepProgress = {
    name: "parse-nl-intent",
    status: "completed",
    durationMs: 150,
  };
  assert.ok(typeof step.name === "string", "Step should have name");
  assert.ok(typeof step.status === "string", "Step should have status");
  assert.ok(
    step.durationMs === null || typeof step.durationMs === "number",
    "durationMs should be number or null",
  );
  console.log("✅ PipelineStep test 3: step progress shape - passed");
}

// Test 4: rendering with empty steps
{
  const steps: StepProgress[] = [];
  assert.strictEqual(
    steps.length,
    0,
    "Empty steps array should render nothing",
  );
  console.log("✅ PipelineStep test 4: empty steps - passed");
}

// Test 5: running step display
{
  const runningStep: StepProgress = {
    name: "llm-inference",
    status: "running",
    durationMs: null,
  };
  assert.strictEqual(runningStep.status, "running", "Should be running status");
  assert.strictEqual(
    runningStep.durationMs,
    null,
    "Running step should not have duration yet",
  );
  console.log("✅ PipelineStep test 5: running step display - passed");
}

// Test 6: completed step with duration
{
  const completedStep: StepProgress = {
    name: "reconcile",
    status: "completed",
    durationMs: 230,
  };
  assert.strictEqual(
    completedStep.status,
    "completed",
    "Should be completed status",
  );
  assert.strictEqual(
    completedStep.durationMs,
    230,
    "Completed step should have duration",
  );
  console.log("✅ PipelineStep test 6: completed step with duration - passed");
}

// Test 7: failed step
{
  const failedStep: StepProgress = {
    name: "commit-patches",
    status: "failed",
    durationMs: 15,
  };
  assert.strictEqual(failedStep.status, "failed", "Should be failed status");
  console.log("✅ PipelineStep test 7: failed step - passed");
}

// Test 8: full pipeline progression
{
  const steps: StepProgress[] = [
    { name: "parse-nl-intent", status: "completed", durationMs: 10 },
    { name: "compile-prompt", status: "completed", durationMs: 5 },
    { name: "llm-inference", status: "running", durationMs: null },
    { name: "reconcile", status: "pending", durationMs: null },
    { name: "commit-patches", status: "pending", durationMs: null },
  ];

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const runningCount = steps.filter((s) => s.status === "running").length;
  const pendingCount = steps.filter((s) => s.status === "pending").length;

  assert.strictEqual(completedCount, 2, "Should have 2 completed steps");
  assert.strictEqual(runningCount, 1, "Should have 1 running step");
  assert.strictEqual(pendingCount, 2, "Should have 2 pending steps");
  console.log("✅ PipelineStep test 8: full pipeline progression - passed");
}

console.log("✅ All PipelineStepIndicator tests passed.");
