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

const ALWAYS_ON = [
  "src/shared/result.ts",
  "src/shared/errors/error-codes.ts",
  "src/domain/errors/domain.error.ts",
  "src/domain/errors/not-found.error.ts",
  "src/domain/errors/validation.error.ts",
  "src/domain/errors/authorization.error.ts",
  "src/application/errors/application.error.ts",
  "src/infrastructure/errors/infrastructure.error.ts",
  "src/infrastructure/errors/external-service.error.ts",
  "src/infrastructure/errors/llm-errors.ts",
  "server/middleware/error-handler.ts",
];

const REACT_FILES = [
  "app/components/ErrorBoundary.tsx",
  "app/components/ErrorFallback.tsx",
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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-errhandling-test-"));
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
  // error-handling requires env-setup; resolve both, override per template.
  const result = await useCase.execute({
    templateIds: ["error-handling"],
    projectRoot,
    overrideAnswers: { "error-handling": answers ?? {} },
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

describe("error-handling template — emit shape", () => {
  describe("defaults (rfc7807, react_boundary=true, sentry=false)", () => {
    let projectRoot: string;
    let warnings: string[];

    before(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the full always-on error layer", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("emits the React boundary by default and not the sentry env file", async () => {
      for (const p of REACT_FILES) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
      assert.equal(
        await exists(path.join(projectRoot, ".env.sentry.example")),
        false,
      );
    });

    it("leaves no unresolved template variables (guards ts/tsx brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates http_mapping and compiles sentry=false off", async () => {
      const handler = await read(
        projectRoot,
        "server/middleware/error-handler.ts",
      );
      assert.ok(handler.includes("strategy: rfc7807-problem-json"));
      assert.ok(handler.includes('"false" === "true"'));
      assert.ok(!handler.includes("{http_mapping}"));
      assert.ok(!handler.includes("{sentry}"));
    });

    it("also installs its env-setup dependency", async () => {
      assert.ok(await exists(path.join(projectRoot, ".env.example")));
    });
  });

  describe("react_boundary=false", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { react_boundary: false });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("does NOT emit the React boundary components", async () => {
      for (const p of REACT_FILES) {
        assert.equal(await exists(path.join(projectRoot, p)), false, p);
      }
    });
  });

  describe("sentry=true", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { sentry: true });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the gated sentry env file and compiles the reporter on", async () => {
      assert.ok(await exists(path.join(projectRoot, ".env.sentry.example")));
      const handler = await read(
        projectRoot,
        "server/middleware/error-handler.ts",
      );
      assert.ok(handler.includes('"true" === "true"'));
    });
  });
});
