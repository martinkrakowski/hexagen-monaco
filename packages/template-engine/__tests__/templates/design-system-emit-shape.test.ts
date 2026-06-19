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
  "DESIGN.md",
  "src/styles/tokens.css",
  "src/styles/globals.css",
  "src/styles/theme.ts",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/index.ts",
  "src/lib/cn.ts",
  "tailwind.config.ts",
];

const STORYBOOK_FILES = [
  ".storybook/main.ts",
  ".storybook/preview.ts",
  "src/components/ui/button.stories.tsx",
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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-ds-test-"));
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
    templateIds: ["design-system"],
    projectRoot,
    ...(answers ? { overrideAnswers: { "design-system": answers } } : {}),
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

describe("design-system template — emit shape", () => {
  describe("defaults (storybook=false)", () => {
    let projectRoot: string;
    let warnings: string[];

    beforeAll(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all always-on files", async () => {
      for (const p of ALWAYS_ON) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("does NOT emit the storybook files when storybook=false", async () => {
      for (const p of STORYBOOK_FILES) {
        assert.equal(
          await exists(path.join(projectRoot, p)),
          false,
          `expected ${p} NOT to be emitted`,
        );
      }
    });

    it("leaves no unresolved template variables (guards JSX brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates the default primary_color into tokens and DESIGN.md", async () => {
      const tokens = await read(projectRoot, "src/styles/tokens.css");
      const design = await read(projectRoot, "DESIGN.md");
      assert.ok(tokens.includes("--color-brand-primary: #6366f1;"));
      assert.ok(design.includes("#6366f1"));
      assert.ok(!tokens.includes("{primary_color}"));
    });

    it("interpolates the default typography into the font stack", async () => {
      const tokens = await read(projectRoot, "src/styles/tokens.css");
      assert.ok(tokens.includes("--font-sans: geist,"));
      assert.ok(!tokens.includes("{typography}"));
    });
  });

  describe("storybook=true + custom brand/typography", () => {
    let projectRoot: string;

    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        primary_color: "#ff0066",
        typography: "inter",
        dark_mode: "css-class",
        component_base: "radix-primitives",
        storybook: true,
      });
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the gated storybook files", async () => {
      for (const p of STORYBOOK_FILES) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("interpolates the custom brand colour", async () => {
      const tokens = await read(projectRoot, "src/styles/tokens.css");
      assert.ok(tokens.includes("--color-brand-primary: #ff0066;"));
    });

    it("interpolates the custom typography and component_base into DESIGN.md", async () => {
      const design = await read(projectRoot, "DESIGN.md");
      assert.ok(design.includes("**inter**"));
      assert.ok(design.includes("**radix-primitives**"));
    });
  });
});
