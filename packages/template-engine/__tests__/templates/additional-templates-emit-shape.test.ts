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
import {
  validateManifest,
  isOutputEnabled,
  outputPath,
} from "../../src/domain/index.js";
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

// Emit-shape coverage for templates that previously had none. Each one's
// outputs are ungated (questions drive interpolation, not file selection), so
// the regression net is: installing it emits every declared output, and every
// `{placeholder}` resolves (no unresolved-variable warnings). Catches a missing
// source file (the emitter silently skips ENOENT), interpolation breakage, and
// manifest/file drift.
const TEMPLATE_IDS = [
  "adobe-ims-spa",
  "better-auth",
  "clerk",
  "llm-adapter",
  "magic-link",
  "nextauth",
  "rate-limiting",
] as const;

function defaultsQuestionEngine(): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.type === "auto") {
        throw new Error(`auto ${q.id} should be resolved by the use case`);
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

async function install(
  id: string,
): Promise<{ root: string; warnings: string[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hexagen-${id}-test-`));
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  // `requires` auto-resolve and co-emit; we only assert the target's outputs.
  const result = await useCase.execute({
    templateIds: [id],
    projectRoot: root,
  });
  return { root, warnings: result.warnings };
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/** The outputs the manifest emits under its default answers. */
function defaultAnswers(questions: TemplateQuestion[]): AnswerMap {
  const map: AnswerMap = {};
  for (const q of questions) {
    if (q.type === "multiselect") map[q.id] = q.default ?? [];
    else if (q.type === "boolean") map[q.id] = q.default ?? false;
    else map[q.id] = (q.default as string) ?? "";
  }
  return map;
}

describe("emit-shape coverage — previously untested templates", () => {
  for (const id of TEMPLATE_IDS) {
    describe(id, () => {
      let root: string;
      let warnings: string[];
      let expectedOutputs: string[];

      before(async () => {
        const manifest = validateManifest(
          JSON.parse(
            await fs.readFile(
              path.join(TEMPLATES_DIR, id, "manifest.json"),
              "utf-8",
            ),
          ),
        );
        const answers = defaultAnswers(manifest.questions);
        expectedOutputs = manifest.outputs
          .filter((o) => isOutputEnabled(o, answers))
          .map(outputPath);
        ({ root, warnings } = await install(id));
      });

      after(async () => {
        if (root) await fs.rm(root, { recursive: true, force: true });
      });

      it("emits every output the manifest declares for default answers", async () => {
        assert.ok(expectedOutputs.length > 0, `${id} declares no outputs`);
        for (const rel of expectedOutputs) {
          assert.ok(await exists(root, rel), `${id}: expected ${rel}`);
        }
      });

      it("leaves no unresolved template variables", () => {
        assert.deepStrictEqual(
          warnings.filter((w) => w.includes("Unresolved template variable")),
          [],
        );
      });
    });
  }
});
