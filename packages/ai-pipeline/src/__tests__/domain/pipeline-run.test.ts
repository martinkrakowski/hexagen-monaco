import assert from "node:assert/strict";
import {
  createPipelineRun,
  startRun,
  completeRun,
  failRun,
  updateRunStep,
  addRunStep,
} from "../../domain/pipeline-run.js";
import {
  createPipelineStep,
  startStep,
  completeStep,
  failStep,
  skipStep,
  stepDurationMs,
} from "../../domain/pipeline-step.js";

describe("PipelineRun", () => {
  describe("createPipelineRun", () => {
    it("should create a run with pending status", () => {
      const run = createPipelineRun("run-1", "test intent");

      assert.strictEqual(run.id, "run-1");
      assert.strictEqual(run.intent, "test intent");
      assert.strictEqual(run.status, "pending");
      assert.deepStrictEqual(run.steps, []);
      assert.ok(run.createdAt !== undefined);
      assert.strictEqual(run.completedAt, undefined);
    });

    it("should create a run with provided steps", () => {
      const steps = [
        createPipelineStep("step-a"),
        createPipelineStep("step-b"),
      ];
      const run = createPipelineRun("run-2", "intent", steps);

      assert.strictEqual(run.steps.length, 2);
      assert.strictEqual(run.steps[0].name, "step-a");
      assert.strictEqual(run.steps[1].name, "step-b");
    });
  });

  describe("startRun", () => {
    it("should transition from pending to running", () => {
      const run = createPipelineRun("run-1", "intent");
      const started = startRun(run);

      assert.strictEqual(started.status, "running");
      assert.strictEqual(started.completedAt, undefined);
    });
  });

  describe("completeRun", () => {
    it("should transition to completed and set completedAt", () => {
      const run = startRun(createPipelineRun("run-1", "intent"));
      const completed = completeRun(run);

      assert.strictEqual(completed.status, "completed");
      assert.ok(completed.completedAt !== undefined);
      assert.strictEqual(typeof completed.completedAt, "number");
    });
  });

  describe("failRun", () => {
    it("should transition to failed and set completedAt", () => {
      const run = startRun(createPipelineRun("run-1", "intent"));
      const failed = failRun(run);

      assert.strictEqual(failed.status, "failed");
      assert.ok(failed.completedAt !== undefined);
    });
  });

  describe("updateRunStep", () => {
    it("should update only the matching step", () => {
      const steps = [
        createPipelineStep("parse"),
        createPipelineStep("compile"),
      ];
      const run = startRun(createPipelineRun("run-1", "intent", steps));
      const updated = updateRunStep(run, "parse", startStep);

      assert.strictEqual(updated.steps[0].status, "running");
      assert.strictEqual(updated.steps[1].status, "pending");
    });

    it("should not mutate steps that don't match", () => {
      const steps = [
        createPipelineStep("parse"),
        createPipelineStep("compile"),
      ];
      const run = startRun(createPipelineRun("run-1", "intent", steps));
      const updated = updateRunStep(run, "compile", (s) =>
        failStep(s, "error"),
      );

      assert.strictEqual(updated.steps[0].status, "pending");
      assert.strictEqual(updated.steps[1].status, "failed");
      assert.strictEqual(updated.steps[1].error, "error");
    });
  });

  describe("addRunStep", () => {
    it("should append a step to the run", () => {
      const run = createPipelineRun("run-1", "intent", [
        createPipelineStep("a"),
      ]);
      const newStep = createPipelineStep("b", { key: "value" });
      const updated = addRunStep(run, newStep);

      assert.strictEqual(updated.steps.length, 2);
      assert.strictEqual(updated.steps[1].name, "b");
      assert.deepStrictEqual(updated.steps[1].metadata, { key: "value" });
    });
  });
});

describe("PipelineStep", () => {
  describe("createPipelineStep", () => {
    it("should create a step with pending status", () => {
      const step = createPipelineStep("parse-nl");

      assert.strictEqual(step.name, "parse-nl");
      assert.strictEqual(step.status, "pending");
      assert.ok(step.startTime !== undefined);
      assert.strictEqual(step.endTime, undefined);
      assert.strictEqual(step.error, undefined);
      assert.deepStrictEqual(step.metadata, {});
    });

    it("should accept initial metadata", () => {
      const step = createPipelineStep("parse-nl", { intent: "add context" });

      assert.deepStrictEqual(step.metadata, { intent: "add context" });
    });
  });

  describe("startStep", () => {
    it("should transition to running and update startTime", () => {
      const step = createPipelineStep("step");
      const started = startStep(step);

      assert.strictEqual(started.status, "running");
      assert.ok(started.startTime !== undefined);
    });
  });

  describe("completeStep", () => {
    it("should transition to completed and set endTime", () => {
      const step = startStep(createPipelineStep("step"));
      const completed = completeStep(step);

      assert.strictEqual(completed.status, "completed");
      assert.ok(completed.endTime !== undefined);
    });
  });

  describe("failStep", () => {
    it("should transition to failed with error message and endTime", () => {
      const step = startStep(createPipelineStep("step"));
      const failed = failStep(step, "something went wrong");

      assert.strictEqual(failed.status, "failed");
      assert.strictEqual(failed.error, "something went wrong");
      assert.ok(failed.endTime !== undefined);
    });
  });

  describe("skipStep", () => {
    it("should transition to skipped with reason in metadata", () => {
      const step = createPipelineStep("step");
      const skipped = skipStep(step, "not needed");

      assert.strictEqual(skipped.status, "skipped");
      assert.ok(skipped.endTime !== undefined);
      assert.strictEqual(skipped.metadata.skipReason, "not needed");
    });

    it("should skip without a reason", () => {
      const step = createPipelineStep("step");
      const skipped = skipStep(step);

      assert.strictEqual(skipped.status, "skipped");
      assert.strictEqual(skipped.metadata.skipReason, undefined);
    });
  });

  describe("stepDurationMs", () => {
    it("should return undefined when step has no endTime", () => {
      const step = createPipelineStep("step");
      assert.strictEqual(stepDurationMs(step), undefined);
    });

    it("should return duration in milliseconds when step has endTime", () => {
      const step = completeStep(startStep(createPipelineStep("step")));
      const duration = stepDurationMs(step);

      assert.strictEqual(typeof duration, "number");
      assert.ok(duration! >= 0);
    });
  });

  describe("lifecycle: pending → running → completed", () => {
    it("should track the full lifecycle of a step", () => {
      let step = createPipelineStep("parse", { intent: "test" });
      assert.strictEqual(step.status, "pending");

      step = startStep(step);
      assert.strictEqual(step.status, "running");

      step = completeStep(step);
      assert.strictEqual(step.status, "completed");
      assert.ok(step.endTime !== undefined);
      assert.strictEqual(step.error, undefined);
    });
  });

  describe("lifecycle: pending → running → failed", () => {
    it("should track a failed lifecycle", () => {
      let step = createPipelineStep("llm-call");
      step = startStep(step);
      step = failStep(step, "timeout");

      assert.strictEqual(step.status, "failed");
      assert.strictEqual(step.error, "timeout");
      assert.ok(step.endTime !== undefined);
    });
  });
});
