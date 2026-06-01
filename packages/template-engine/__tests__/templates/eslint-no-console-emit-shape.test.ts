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

function questionEngine(
  overrides: Record<string, QuestionAnswer> = {},
): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.id in overrides) return overrides[q.id]!;
      if (q.type === "auto")
        throw new Error(`auto ${q.id} resolved by use case`);
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(`unhandled type: ${(_ex as { type: string }).type}`);
    },
  };
}

async function read(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), "utf-8");
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

async function install(
  overrides?: Record<string, QuestionAnswer>,
): Promise<{ root: string; warnings: string[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-eslint-nc-"));
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    questionEngine(overrides),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  const result = await useCase.execute({
    templateIds: ["eslint-no-console"],
    projectRoot: root,
  });
  return { root, warnings: result.warnings };
}

describe("eslint-no-console template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    ({ root, warnings } = await install());
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the flat-config fragment", async () => {
    assert.ok(await exists(root, "eslint.no-console.mjs"));
  });

  it("bans console.* and exempts the sanctioned sites", async () => {
    const cfg = await read(root, "eslint.no-console.mjs");
    assert.ok(cfg.includes("export const noConsoleConfig"));
    assert.ok(cfg.includes('"no-console"'));
    // default severity is the non-breaking "warn"; no leftover placeholder
    assert.ok(cfg.includes('"no-console": "warn"'));
    assert.ok(!cfg.includes("{console_level}"));
    // the logger transport + startup/scripts/config are exempted (off)
    assert.ok(cfg.includes("infrastructure/logging/**"));
    assert.ok(cfg.includes("server/startup/**"));
    assert.ok(cfg.includes("scripts/**"));
    assert.ok(cfg.includes('"no-console": "off"'));
  });

  it("honours the console_level answer (error override)", async () => {
    const errorInstall = await install({ console_level: "error" });
    try {
      const cfg = await read(errorInstall.root, "eslint.no-console.mjs");
      assert.ok(cfg.includes('"no-console": "error"'));
    } finally {
      await fs.rm(errorInstall.root, { recursive: true, force: true });
    }
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
