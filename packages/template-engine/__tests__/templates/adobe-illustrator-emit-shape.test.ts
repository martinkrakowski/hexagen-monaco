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

describe("adobe-illustrator template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-illustrator-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-illustrator"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the illustrator port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/illustrator.port.ts`,
      `${ADOBE}/illustrator/illustrator.adapter.ts`,
      ".env.adobe-illustrator.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a method per operation and types failures without infra coupling", async () => {
    const port = await read(root, `${PORTS}/illustrator.port.ts`);
    for (const method of ["renderArtboard", "dataMerge", "scaleVector"]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("targets image.adobe.io and always polls the status URL (mode-agnostic)", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/illustrator/illustrator.adapter.ts`,
    );
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("image.adobe.io"));
    assert.ok(adapter.includes("/aiService/"));
    assert.ok(adapter.includes("normalizeBase"));
    assert.ok(adapter.includes("scheme.toLowerCase()"));
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes('storage: "external"'));
    // image.adobe.io is polled by status URL regardless of job_mode; a missing
    // status URL is a clear error, and jobPort.await (which fails for a jobId-only
    // handle in polling mode) is not used.
    assert.ok(adapter.includes("if (!handle.statusUrl)"));
    assert.ok(adapter.includes("await pollJobStatus(handle)"));
    assert.ok(adapter.includes("no status URL to track"));
    assert.ok(
      !adapter.includes("jobPort.await"),
      "must not route through jobPort.await",
    );
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
    // scaleVector fails fast when no dimension is supplied (guaranteed API 400)
    assert.ok(adapter.includes("scaleVector requires at least one"));
    assert.ok(adapter.includes("FireflyValidationError"));
  });

  it("validates the format env and interpolates the defaults", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/illustrator/illustrator.adapter.ts`,
    );
    assert.ok(adapter.includes("ADOBE_ILLUSTRATOR_BASE_URL?.trim() ||"));
    assert.ok(
      adapter.includes(
        'rawDefaultFormat === "png" || rawDefaultFormat === "jpeg" || rawDefaultFormat === "pdf"',
      ),
    );
    assert.ok(adapter.includes('"png"'));
    assert.ok(adapter.includes("renderArtboard"));
    assert.ok(!adapter.includes("{output_format}"));
    assert.ok(!adapter.includes("{operations}"));
    const env = await read(root, ".env.adobe-illustrator.example");
    assert.ok(env.includes("ADOBE_ILLUSTRATOR_FORMAT=png"));
    assert.ok(env.includes("Enabled operations: renderArtboard"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
