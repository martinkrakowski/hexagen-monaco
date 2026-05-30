import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import type {
  TemplateQuestion,
  QuestionAnswer,
} from "../../src/domain/index.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

function defaultsQuestionEngine(): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.type === "auto") {
        throw new Error(
          `auto question ${q.id} should be resolved by the use case`,
        );
      }
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(`unhandled type: ${(_ex as { type: string }).type}`);
    },
  };
}

async function freshProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-bullmq-test-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("bullmq template — gated outputs reflect the install answers", () => {
  describe("minimal install (defaults: bull_board=true, no job_examples, same-process)", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      const useCase = new AddTemplateUseCase(
        new FileSystemTemplateRegistry(TEMPLATES_DIR),
        defaultsQuestionEngine(),
        new FileSystemFileEmitter(TEMPLATES_DIR),
        new FileSystemTemplateConfigStore(),
      );
      await useCase.execute({ templateIds: ["bullmq"], projectRoot });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the always-on core files", async () => {
      for (const p of [
        "src/infrastructure/queue/connection.ts",
        "src/infrastructure/queue/queues.ts",
        "src/infrastructure/queue/workers.ts",
        "src/infrastructure/queue/index.ts",
        "src/infrastructure/queue/fallback/sync-executor.ts",
        "src/infrastructure/queue/scheduler/job-scheduler.ts",
        "server/startup/start-workers.ts",
        ".env.bullmq.example",
      ]) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("emits the bull-board route (default bull_board=true)", async () => {
      assert.ok(
        await exists(
          path.join(projectRoot, "app/admin/queues/[[...slug]]/route.ts"),
        ),
      );
    });

    it("does NOT emit the separate-service entrypoint (default worker_mode=same-process)", async () => {
      assert.equal(
        await exists(path.join(projectRoot, "scripts/start-worker.ts")),
        false,
      );
    });

    it("does NOT emit any job example files (default job_examples=[])", async () => {
      for (const p of [
        "src/infrastructure/queue/jobs/image-processing.job.ts",
        "src/infrastructure/queue/jobs/email.job.ts",
        "src/infrastructure/queue/jobs/webhook.job.ts",
        "src/infrastructure/queue/jobs/export.job.ts",
        "src/infrastructure/queue/jobs/ai-generation.job.ts",
      ]) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted with empty job_examples`,
        );
      }
    });
  });

  describe("full install (separate-service, all jobs, bull_board=false)", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      const useCase = new AddTemplateUseCase(
        new FileSystemTemplateRegistry(TEMPLATES_DIR),
        defaultsQuestionEngine(),
        new FileSystemFileEmitter(TEMPLATES_DIR),
        new FileSystemTemplateConfigStore(),
      );
      await useCase.execute({
        templateIds: ["bullmq"],
        projectRoot,
        overrideAnswers: {
          bullmq: {
            worker_mode: "separate-service",
            queue_names: "default,images",
            job_examples: [
              "image-processing",
              "email",
              "webhook",
              "export",
              "ai-generation",
            ],
            redis_source: "local",
            concurrency: "5",
            bull_board: false,
          },
        },
      });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the separate-service entrypoint", async () => {
      assert.ok(
        await exists(path.join(projectRoot, "scripts/start-worker.ts")),
      );
    });

    it("emits all five job example files", async () => {
      for (const name of [
        "image-processing",
        "email",
        "webhook",
        "export",
        "ai-generation",
      ]) {
        assert.ok(
          await exists(
            path.join(
              projectRoot,
              `src/infrastructure/queue/jobs/${name}.job.ts`,
            ),
          ),
          `expected ${name}.job.ts to be emitted`,
        );
      }
    });

    it("does NOT emit the bull-board route when bull_board=false", async () => {
      assert.equal(
        await exists(
          path.join(projectRoot, "app/admin/queues/[[...slug]]/route.ts"),
        ),
        false,
      );
    });
  });
});
