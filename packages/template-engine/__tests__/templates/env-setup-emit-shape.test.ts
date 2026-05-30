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
  AnswerMap,
} from "../../src/domain/index.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const OUTPUTS = [
  ".env.example",
  "src/config/env.ts",
  "src/config/env.server.ts",
  "src/config/env.client.ts",
  "scripts/check-env.ts",
  "SETUP.md",
];

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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-env-test-"));
}

async function install(
  projectRoot: string,
  answers?: AnswerMap,
): Promise<{ warnings: string[] }> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  const result = await useCase.execute({
    templateIds: ["env-setup"],
    projectRoot,
    ...(answers ? { overrideAnswers: { "env-setup": answers } } : {}),
  });
  return { warnings: result.warnings };
}

async function read(projectRoot: string, rel: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, rel), "utf-8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("env-setup template — emit shape", () => {
  describe("defaults (framework=next.js, strict_validation=true)", () => {
    let projectRoot: string;
    let warnings: string[];

    before(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all six outputs", async () => {
      for (const p of OUTPUTS) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("leaves no unresolved template variables (guards ts/md brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("compiles strict_validation=true into a strict server guard", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes('"true" === "true"'));
      assert.ok(!serverEnv.includes("{strict_validation}"));
    });

    it("interpolates the framework into SETUP.md and the env barrel", async () => {
      const setup = await read(projectRoot, "SETUP.md");
      const barrel = await read(projectRoot, "src/config/env.ts");
      assert.ok(setup.includes("Framework: **next.js**"));
      assert.ok(barrel.includes("Framework: next.js"));
      assert.ok(!setup.includes("{framework}"));
    });

    it("non-strict fallback uses pure defaults that cannot throw", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes("ServerEnvSchema.parse({})"));
      assert.ok(
        !serverEnv.includes("parse({ NODE_ENV: process.env.NODE_ENV })"),
        "fallback must not re-parse a possibly-invalid NODE_ENV",
      );
    });

    it("check-env scans per-template .env.*.example files, not just .env.example", async () => {
      const checkEnv = await read(projectRoot, "scripts/check-env.ts");
      assert.ok(checkEnv.includes("readdirSync"));
      assert.ok(checkEnv.includes('endsWith(".example")'));
    });
  });

  describe("strict_validation=false, framework=express", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        framework: "express",
        strict_validation: false,
      });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("compiles strict_validation=false into a non-strict guard", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes('"false" === "true"'));
    });

    it("interpolates the chosen framework", async () => {
      const setup = await read(projectRoot, "SETUP.md");
      assert.ok(setup.includes("Framework: **express**"));
    });
  });
});
