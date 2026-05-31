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

describe("adobe-firefly-upscale template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-upscale-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — they auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-upscale"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the upscale port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/upscale.port.ts`,
      `${ADOBE}/upscale/upscale.adapter.ts`,
      ".env.adobe-upscale.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
    const jobResult = await read(root, `${ADOBE}/jobs/job-result.ts`);
    assert.ok(jobResult.includes("export function toJobHandle"));
  });

  it("types the port's failure channel without runtime infra coupling", async () => {
    const port = await read(root, `${PORTS}/upscale.port.ts`);
    assert.ok(port.includes("interface UpscalePort"));
    // FireflyError reaches the port only as a type-only import (erased at compile).
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("drives the foundation: presign -> submit -> await -> Result", async () => {
    const adapter = await read(root, `${ADOBE}/upscale/upscale.adapter.ts`);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes('fireflyClient.post("/v3/images/upscale"'));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes("jobPort.await(handle)"));
    assert.ok(adapter.includes('storage: "external"'));
    // Result at the boundary, not throws.
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("interpolates the default factor (env-overridable) and validates it", async () => {
    const adapter = await read(root, `${ADOBE}/upscale/upscale.adapter.ts`);
    // install default interpolated as the fallback; env can override
    assert.ok(adapter.includes('Number("2")'));
    assert.ok(adapter.includes("process.env.ADOBE_UPSCALE_FACTOR"));
    assert.ok(!adapter.includes("{default_factor}"));
    // a misconfigured env / bad req.factor must not reach the API as NaN/0
    assert.ok(adapter.includes("isValidFactor"));
    assert.ok(adapter.includes("Number.isFinite"));
    assert.ok(adapter.includes("FireflyValidationError"));
    const env = await read(root, ".env.adobe-upscale.example");
    assert.ok(env.includes("ADOBE_UPSCALE_FACTOR=2"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
