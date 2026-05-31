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

describe("adobe-photoshop template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-photoshop-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-photoshop"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the photoshop port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/photoshop-automation.port.ts`,
      `${ADOBE}/photoshop/photoshop-automation.adapter.ts`,
      ".env.adobe-photoshop.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a method per operation and types failures without infra coupling", async () => {
    const port = await read(root, `${PORTS}/photoshop-automation.port.ts`);
    for (const method of [
      "smartObject",
      "editTextLayer",
      "applyActionJson",
      "crop",
      "renderPsd",
    ]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("targets the image.adobe.io host and tolerates a status-URL-only job", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/photoshop/photoshop-automation.adapter.ts`,
    );
    assert.match(adapter, /@hexagen-server-only/);
    // different host than firefly-api — absolute URLs to image.adobe.io/pie/psdService
    assert.ok(adapter.includes("image.adobe.io"));
    assert.ok(adapter.includes("/pie/psdService/"));
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes('storage: "external"'));
    // Photoshop tracks jobs by status URL (often no jobId) — accept either, not the
    // strict jobId-only guard the Firefly image services use.
    assert.ok(adapter.includes("!handle.jobId && !handle.statusUrl"));
    // a status-URL-only job polls directly (works in webhook mode too, where
    // jobPort.await would reject a missing jobId); jobId-only falls back to await.
    assert.ok(adapter.includes("pollJobStatus(handle)"));
    assert.ok(adapter.includes("? await pollJobStatus(handle)"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("hardens the host/format env and interpolates the defaults", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/photoshop/photoshop-automation.adapter.ts`,
    );
    assert.ok(adapter.includes("ADOBE_PHOTOSHOP_BASE_URL?.trim() ||"));
    // format strictly validated against the union (no blind cast of a bad env value)
    assert.ok(adapter.includes("ADOBE_PHOTOSHOP_FORMAT?.trim()"));
    assert.ok(
      adapter.includes(
        'rawDefaultFormat === "jpeg" || rawDefaultFormat === "png"',
      ),
    );
    // base URL normalised: a schemeless host gets https:// so fireflyClient treats it as absolute
    assert.ok(adapter.includes("normalizeBase"));
    assert.ok(adapter.includes("`https://${raw}`"));
    // scheme lowercased (consistent with Lightroom; defensive even though the
    // core client now matches case-insensitively)
    assert.ok(adapter.includes("scheme.toLowerCase()"));
    assert.ok(adapter.includes('"jpeg"'));
    assert.ok(adapter.includes("smartObject"));
    assert.ok(!adapter.includes("{output_format}"));
    assert.ok(!adapter.includes("{operations}"));
    const env = await read(root, ".env.adobe-photoshop.example");
    assert.ok(env.includes("ADOBE_PHOTOSHOP_FORMAT=jpeg"));
    assert.ok(env.includes("Enabled operations: smartObject"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
