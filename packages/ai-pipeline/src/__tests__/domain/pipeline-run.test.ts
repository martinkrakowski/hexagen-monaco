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

      expect(run.id).toBe("run-1");
      expect(run.intent).toBe("test intent");
      expect(run.status).toBe("pending");
      expect(run.steps).toEqual([]);
      expect(run.createdAt).toBeDefined();
      expect(run.completedAt).toBeUndefined();
    });

    it("should create a run with provided steps", () => {
      const steps = [
        createPipelineStep("step-a"),
        createPipelineStep("step-b"),
      ];
      const run = createPipelineRun("run-2", "intent", steps);

      expect(run.steps).toHaveLength(2);
      expect(run.steps[0].name).toBe("step-a");
      expect(run.steps[1].name).toBe("step-b");
    });
  });

  describe("startRun", () => {
    it("should transition from pending to running", () => {
      const run = createPipelineRun("run-1", "intent");
      const started = startRun(run);

      expect(started.status).toBe("running");
      expect(started.completedAt).toBeUndefined();
    });
  });

  describe("completeRun", () => {
    it("should transition to completed and set completedAt", () => {
      const run = startRun(createPipelineRun("run-1", "intent"));
      const completed = completeRun(run);

      expect(completed.status).toBe("completed");
      expect(completed.completedAt).toBeDefined();
      expect(typeof completed.completedAt).toBe("number");
    });
  });

  describe("failRun", () => {
    it("should transition to failed and set completedAt", () => {
      const run = startRun(createPipelineRun("run-1", "intent"));
      const failed = failRun(run);

      expect(failed.status).toBe("failed");
      expect(failed.completedAt).toBeDefined();
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

      expect(updated.steps[0].status).toBe("running");
      expect(updated.steps[1].status).toBe("pending");
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

      expect(updated.steps[0].status).toBe("pending");
      expect(updated.steps[1].status).toBe("failed");
      expect(updated.steps[1].error).toBe("error");
    });
  });

  describe("addRunStep", () => {
    it("should append a step to the run", () => {
      const run = createPipelineRun("run-1", "intent", [
        createPipelineStep("a"),
      ]);
      const newStep = createPipelineStep("b", { key: "value" });
      const updated = addRunStep(run, newStep);

      expect(updated.steps).toHaveLength(2);
      expect(updated.steps[1].name).toBe("b");
      expect(updated.steps[1].metadata).toEqual({ key: "value" });
    });
  });
});

describe("PipelineStep", () => {
  describe("createPipelineStep", () => {
    it("should create a step with pending status", () => {
      const step = createPipelineStep("parse-nl");

      expect(step.name).toBe("parse-nl");
      expect(step.status).toBe("pending");
      expect(step.startTime).toBeDefined();
      expect(step.endTime).toBeUndefined();
      expect(step.error).toBeUndefined();
      expect(step.metadata).toEqual({});
    });

    it("should accept initial metadata", () => {
      const step = createPipelineStep("parse-nl", { intent: "add context" });

      expect(step.metadata).toEqual({ intent: "add context" });
    });
  });

  describe("startStep", () => {
    it("should transition to running and update startTime", () => {
      const step = createPipelineStep("step");
      const started = startStep(step);

      expect(started.status).toBe("running");
      expect(started.startTime).toBeDefined();
    });
  });

  describe("completeStep", () => {
    it("should transition to completed and set endTime", () => {
      const step = startStep(createPipelineStep("step"));
      const completed = completeStep(step);

      expect(completed.status).toBe("completed");
      expect(completed.endTime).toBeDefined();
    });
  });

  describe("failStep", () => {
    it("should transition to failed with error message and endTime", () => {
      const step = startStep(createPipelineStep("step"));
      const failed = failStep(step, "something went wrong");

      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("something went wrong");
      expect(failed.endTime).toBeDefined();
    });
  });

  describe("skipStep", () => {
    it("should transition to skipped with reason in metadata", () => {
      const step = createPipelineStep("step");
      const skipped = skipStep(step, "not needed");

      expect(skipped.status).toBe("skipped");
      expect(skipped.endTime).toBeDefined();
      expect(skipped.metadata.skipReason).toBe("not needed");
    });

    it("should skip without a reason", () => {
      const step = createPipelineStep("step");
      const skipped = skipStep(step);

      expect(skipped.status).toBe("skipped");
      expect(skipped.metadata.skipReason).toBeUndefined();
    });
  });

  describe("stepDurationMs", () => {
    it("should return undefined when step has no endTime", () => {
      const step = createPipelineStep("step");
      expect(stepDurationMs(step)).toBeUndefined();
    });

    it("should return duration in milliseconds when step has endTime", () => {
      const step = completeStep(startStep(createPipelineStep("step")));
      const duration = stepDurationMs(step);

      expect(typeof duration).toBe("number");
      expect(duration!).toBeGreaterThanOrEqual(0);
    });
  });

  describe("lifecycle: pending → running → completed", () => {
    it("should track the full lifecycle of a step", () => {
      let step = createPipelineStep("parse", { intent: "test" });
      expect(step.status).toBe("pending");

      step = startStep(step);
      expect(step.status).toBe("running");

      step = completeStep(step);
      expect(step.status).toBe("completed");
      expect(step.endTime).toBeDefined();
      expect(step.error).toBeUndefined();
    });
  });

  describe("lifecycle: pending → running → failed", () => {
    it("should track a failed lifecycle", () => {
      let step = createPipelineStep("llm-call");
      step = startStep(step);
      step = failStep(step, "timeout");

      expect(step.status).toBe("failed");
      expect(step.error).toBe("timeout");
      expect(step.endTime).toBeDefined();
    });
  });
});
