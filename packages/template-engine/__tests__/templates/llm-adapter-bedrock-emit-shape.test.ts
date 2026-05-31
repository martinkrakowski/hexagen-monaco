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

const ADAPTERS = "src/infrastructure/llm/adapters";

describe("llm-adapter-bedrock template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-bedrock-test-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires llm-adapter (+ error-handling, env-setup) — they auto-resolve.
    const result = await useCase.execute({
      templateIds: ["llm-adapter-bedrock"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the addon files", async () => {
    for (const rel of [
      `${ADAPTERS}/bedrock-llm-client.adapter.ts`,
      `${ADAPTERS}/bedrock-register.ts`,
      "src/infrastructure/llm/errors/bedrock-errors.ts",
      ".env.bedrock.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the base llm-adapter, including the provider-registration seam", async () => {
    assert.ok(
      await exists(root, "src/infrastructure/llm/router/provider-registry.ts"),
      "base seam file must be emitted by the resolved llm-adapter",
    );
    const barrel = await read(root, "src/infrastructure/llm/index.ts");
    assert.match(barrel, /export \{ registerProvider \}/);
    // The router fails fast with an actionable message if a provider isn't
    // registered (missing side-effect import), instead of a generic error.
    const router = await read(
      root,
      "src/infrastructure/llm/router/llm-router.ts",
    );
    assert.match(router, /Unknown LLM provider/);
    assert.ok(router.includes("import its registration module"));
    // Registered adapters are lazy — only the selected provider is instantiated.
    assert.match(router, /if \(name === primaryProvider\)/);
    // A registered name may not shadow a built-in.
    assert.ok(router.includes("collides with a built-in"));
    // The registry rejects duplicate registrations.
    const registry = await read(
      root,
      "src/infrastructure/llm/router/provider-registry.ts",
    );
    assert.ok(registry.includes("is already registered"));
  });

  it("registers bedrock and interpolates the chosen inference profile", async () => {
    const register = await read(root, `${ADAPTERS}/bedrock-register.ts`);
    assert.match(register, /registerProvider\(\s*["']bedrock["']/);
    // the {bedrock_inference} placeholder resolved to the default model id
    assert.ok(register.includes("us.anthropic.claude-sonnet-4-20250514-v1:0"));
    assert.ok(!register.includes("{bedrock_inference}"));
  });

  it("uses the Converse API and leaves AWS region to the SDK cascade", async () => {
    const adapter = await read(
      root,
      `${ADAPTERS}/bedrock-llm-client.adapter.ts`,
    );
    assert.ok(adapter.includes("ConverseCommand"));
    assert.match(adapter, /@hexagen-server-only/);
    // region is only passed when explicitly set — never a hardcoded literal
    assert.match(adapter, /region \? \{ region \} : \{\}/);
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
