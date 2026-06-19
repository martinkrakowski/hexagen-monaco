import { describe, it, beforeAll, afterAll } from "vitest";
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
  "AGENTS.md",
  ".agents/architecture.md",
  ".agents/testing.md",
  ".agents/git.md",
  ".agents/tech-stack.md",
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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-agents-test-"));
}

async function installTemplates(
  projectRoot: string,
  templateIds: string[],
  overrideAnswers?: Record<string, AnswerMap>,
): Promise<{ warnings: string[] }> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  const result = await useCase.execute({
    templateIds,
    projectRoot,
    ...(overrideAnswers ? { overrideAnswers } : {}),
  });
  return { warnings: result.warnings };
}

async function install(
  projectRoot: string,
  answers?: AnswerMap,
): Promise<{ warnings: string[] }> {
  return installTemplates(
    projectRoot,
    ["agents-md"],
    answers ? { "agents-md": answers } : undefined,
  );
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

describe("agents-md template — emit shape", () => {
  describe("custom answers, session_logging=true", () => {
    let projectRoot: string;
    let warnings: string[];

    beforeAll(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot, {
        project_description: "A widget factory API",
        architecture_style: "layered",
        session_logging: true,
      }));
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all always-on files", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("emits the gated session log when session_logging=true", async () => {
      assert.ok(await exists(path.join(projectRoot, ".agents/session-log.md")));
    });

    it("leaves no unresolved template variables (guards markdown brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates project_description and architecture_style", async () => {
      const agents = await read(projectRoot, "AGENTS.md");
      const arch = await read(projectRoot, ".agents/architecture.md");
      assert.ok(agents.includes("A widget factory API"));
      assert.ok(agents.includes("**layered**"));
      assert.ok(arch.includes("Style: **layered**"));
      assert.ok(!agents.includes("{project_description}"));
      assert.ok(!arch.includes("{architecture_style}"));
    });

    it("only mandates what the scaffold installed (RCA #9 — governance truth)", async () => {
      const agents = await read(projectRoot, "AGENTS.md");
      // agents-md alone: no logger was installed, so AGENTS.md must not
      // reference the observability logger path or carry the hard no-console
      // mandate — both live in .agents/logging.md, which ships WITH the
      // logger (observability template).
      assert.ok(
        !agents.includes("src/infrastructure/logging/logger.ts"),
        "must not reference a logger path nothing installed",
      );
      assert.ok(
        !agents.includes("Never `console.log`"),
        "the hard mandate belongs to .agents/logging.md (observability)",
      );
      assert.ok(
        agents.includes("If the `observability` template is installed"),
        "logging guidance must be conditional on the template being present",
      );
      assert.ok(
        agents.includes(
          "`eslint-no-console` template is installed, lint/CI enforces the ban",
        ),
        "enforcement claim must be conditional on the lint template being present",
      );
      assert.equal(
        await exists(path.join(projectRoot, ".agents/logging.md")),
        false,
        ".agents/logging.md belongs to observability, not agents-md",
      );
    });
  });

  describe("logging-spec ownership (RCA #9) — the mandate ships with the logger", () => {
    describe("observability alone", () => {
      let projectRoot: string;

      beforeAll(async () => {
        projectRoot = await freshProject();
        await installTemplates(projectRoot, ["observability"]);
      });

      afterAll(async () => {
        await fs.rm(projectRoot, { recursive: true, force: true });
      });

      it("ships the binding logging spec alongside the logger it mandates", async () => {
        const spec = await read(projectRoot, ".agents/logging.md");
        assert.ok(spec.includes("src/infrastructure/logging/logger.ts"));
        assert.ok(spec.includes("Never `console.log`"));
        assert.ok(
          await exists(
            path.join(projectRoot, "src/infrastructure/logging/logger.ts"),
          ),
          "the spec and the logger it mandates install together",
        );
      });

      it("conditions the lint-enforcement claim on eslint-no-console being installed", async () => {
        const spec = await read(projectRoot, ".agents/logging.md");
        assert.ok(
          spec.includes(
            "If the `eslint-no-console` template is also installed",
          ),
        );
      });
    });

    describe("agents-md + observability together", () => {
      let projectRoot: string;

      beforeAll(async () => {
        projectRoot = await freshProject();
        await installTemplates(projectRoot, ["agents-md", "observability"], {
          "agents-md": {
            project_description: "A widget factory API",
            architecture_style: "hexagonal",
            session_logging: false,
          },
        });
      });

      afterAll(async () => {
        await fs.rm(projectRoot, { recursive: true, force: true });
      });

      it("the AGENTS.md pointer resolves — .agents/logging.md exists", async () => {
        const agents = await read(projectRoot, "AGENTS.md");
        assert.ok(agents.includes(".agents/logging.md"));
        assert.ok(
          await exists(path.join(projectRoot, ".agents/logging.md")),
          "with observability installed the pointer must not dangle",
        );
      });
    });
  });

  describe("session_logging=false", () => {
    let projectRoot: string;

    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        project_description: "x",
        architecture_style: "hexagonal",
        session_logging: false,
      });
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("still emits the always-on files", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("does NOT emit the session log", async () => {
      assert.equal(
        await exists(path.join(projectRoot, ".agents/session-log.md")),
        false,
      );
    });
  });
});
