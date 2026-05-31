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

describe("adobe-express template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-express-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-express"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the express port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/express.port.ts`,
      `${ADOBE}/express/express.adapter.ts`,
      ".env.adobe-express.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a batch port returning many hrefs without infra coupling", async () => {
    const port = await read(root, `${PORTS}/express.port.ts`);
    assert.ok(port.includes("renderBatch("), "port must declare renderBatch");
    // batch resolves to one href per variant
    assert.ok(port.includes("Promise<Result<string[], FireflyError>>"));
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("targets image.adobe.io and waits via the centralised jobPort.poll", async () => {
    const adapter = await read(root, `${ADOBE}/express/express.adapter.ts`);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("image.adobe.io"));
    assert.ok(adapter.includes("/express/"));
    assert.ok(adapter.includes("normalizeBase"));
    assert.ok(adapter.includes("scheme.toLowerCase()"));
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes('storage: "external"'));
    // status-URL-required guard + centralised poll; no direct poller import, no await fallback
    assert.ok(adapter.includes("if (!handle.statusUrl)"));
    assert.ok(adapter.includes("jobPort.poll(handle)"));
    assert.ok(adapter.includes("no status URL to track"));
    assert.ok(
      !adapter.includes("jobPort.await"),
      "must not route through jobPort.await",
    );
    assert.ok(
      !adapter.includes("pollJobStatus"),
      "must use jobPort.poll, not the poller directly",
    );
    // batch maps every output to an href (not just [0]) and presigns per variant
    assert.ok(adapter.includes("done.outputs"));
    assert.ok(adapter.includes("req.items.map("));
    // avoids the Express.js name collision
    assert.ok(adapter.includes("export const expressAutomation"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("validates the format env and interpolates the defaults", async () => {
    const adapter = await read(root, `${ADOBE}/express/express.adapter.ts`);
    assert.ok(adapter.includes("ADOBE_EXPRESS_BASE_URL?.trim() ||"));
    assert.ok(
      adapter.includes(
        'rawDefaultFormat === "jpg" || rawDefaultFormat === "png" || rawDefaultFormat === "pdf"',
      ),
    );
    assert.ok(adapter.includes('"jpg"'));
    assert.ok(!adapter.includes("{output_format}"));
    const env = await read(root, ".env.adobe-express.example");
    assert.ok(env.includes("ADOBE_EXPRESS_FORMAT=jpg"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
