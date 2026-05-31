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

const PORTS = "src/domain/ports/out";
const ADOBE = "src/infrastructure/adobe";

describe("adobe-firefly-generate template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-firefly-generate-"),
    );
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-generate"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the generate port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/image-generation.port.ts`,
      `${ADOBE}/generate/firefly-generate.adapter.ts`,
      ".env.adobe-generate.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a method per operation and types failures without infra coupling", async () => {
    const port = await read(root, `${PORTS}/image-generation.port.ts`);
    for (const method of [
      "textToImage",
      "generativeFill",
      "generativeExpand",
      "imageToImage",
      "styleTransfer",
    ]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("drives the foundation and passes policy flags through, not hardcoded", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/generate/firefly-generate.adapter.ts`,
    );
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes("jobPort.await(handle)"));
    assert.ok(adapter.includes('storage: "external"'));
    // empty-jobId guard at the call site (matches the upscale pattern)
    assert.ok(adapter.includes("if (!handle.jobId)"));
    // content-credentials + safety pass through verbatim
    assert.ok(adapter.includes("opts.contentCredentials"));
    assert.ok(adapter.includes("opts.safety"));
    // Result at the boundary
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("interpolates size + enabled operations", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/generate/firefly-generate.adapter.ts`,
    );
    assert.ok(adapter.includes('"2048x2048"'));
    assert.ok(adapter.includes("text-to-image"));
    assert.ok(!adapter.includes("{default_size}"));
    assert.ok(!adapter.includes("{operations}"));
    const env = await read(root, ".env.adobe-generate.example");
    assert.ok(env.includes("ADOBE_FIREFLY_SIZE=2048x2048"));
    assert.ok(env.includes("Enabled operations: text-to-image"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
