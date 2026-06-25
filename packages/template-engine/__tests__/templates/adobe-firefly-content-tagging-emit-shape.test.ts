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

describe("adobe-firefly-content-tagging template — emit shape", () => {
  let root: string;
  let warnings: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-tag-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-content-tagging"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the content-tagging port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/content-tagging.port.ts`,
      `${ADOBE}/content-tagging/content-tagging.adapter.ts`,
      ".env.adobe-content-tagging.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("returns JSON tags, not an asset, and types failures without infra coupling", async () => {
    const port = await read(root, `${PORTS}/content-tagging.port.ts`);
    assert.ok(port.includes("interface ContentTaggingPort"));
    assert.ok(port.includes("tag(inputHref: string)"));
    assert.ok(port.includes("interface ContentTaggingResult"));
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("exercises the non-asset path and tolerates sync OR async responses", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/content-tagging/content-tagging.adapter.ts`,
    );
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post"));
    assert.ok(adapter.includes("toJobHandle("));
    // non-asset path: reads JobResult.outputs[].data, not href
    assert.ok(adapter.includes("done.outputs[0]?.data"));
    // sync-tolerant: awaits when the response carried a status URL OR a job id;
    // only a response with NEITHER is treated as synchronous (tags inline).
    assert.ok(adapter.includes("handle.statusUrl || handle.jobId"));
    assert.ok(adapter.includes("if (isAsync)"));
    // a succeeded async job with no data is an error, not a fake empty success
    assert.ok(adapter.includes("produced no output data"));
    assert.ok(
      !adapter.includes("done.outputs[0]?.data ?? response"),
      "async-success path must not fall back to the submit response",
    );
    assert.ok(
      !adapter.includes("did not include a job id"),
      "content tagging must not fail on a missing job id (sync responses have none)",
    );
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("hardens the confidence floor against empty/invalid env", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/content-tagging/content-tagging.adapter.ts`,
    );
    // empty env treated as unset (no NaN floor): resolveMinConfidence(raw?.trim() || default)
    assert.ok(adapter.includes("process.env.ADOBE_TAGGING_MIN_CONFIDENCE"));
    assert.ok(adapter.includes("resolveMinConfidence"));
    assert.ok(adapter.includes("raw?.trim() ||"));
    assert.ok(adapter.includes("Number.isFinite"));
    // confidence coerced tolerantly — accepts a numeric string ("0.8"), not just number
    assert.ok(adapter.includes("toConfidence"));
    assert.ok(adapter.includes('typeof value === "string"'));
  });

  it("interpolates the confidence floor", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/content-tagging/content-tagging.adapter.ts`,
    );
    assert.ok(adapter.includes('Number("0.5")'));
    assert.ok(!adapter.includes("{min_confidence}"));
    const env = await read(root, ".env.adobe-content-tagging.example");
    assert.ok(env.includes("ADOBE_TAGGING_MIN_CONFIDENCE=0.5"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
