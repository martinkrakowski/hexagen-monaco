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

describe("adobe-substance-3d template — emit shape", () => {
  let root: string;
  let warnings: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-substance-3d-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-substance-3d"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the substance-3d port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/substance-3d.port.ts`,
      `${ADOBE}/substance-3d/substance-3d.adapter.ts`,
      ".env.adobe-substance-3d.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a method per operation with extra inputs, no infra coupling", async () => {
    const port = await read(root, `${PORTS}/substance-3d.port.ts`);
    for (const method of ["render", "composite", "relight"]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    // composite/relight carry an extra presigned input each
    assert.ok(port.includes("backgroundHref"));
    assert.ok(port.includes("environmentHref"));
    // ADR-0053: the failure channel is a DOMAIN union the port owns. The
    // vendor error classes stay in infrastructure and are mapped at the
    // adapter boundary, so the port names no infrastructure symbol at all —
    // a type-only import would still be a compile-time domain→infra edge.
    assert.match(
      port,
      /import type \{\s*CreativeServiceError\s*\} from "\.\.\/\.\.\/errors\/creative-service-error"/,
    );
    assert.ok(
      !/infrastructure\//.test(port),
      "port must not reference infrastructure/ (ADR-0053 §3)",
    );
    assert.ok(
      !/\bFireflyError\b/.test(port),
      "port must not name the vendor error class",
    );
  });

  it("targets image.adobe.io and waits via the centralised jobPort.poll", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/substance-3d/substance-3d.adapter.ts`,
    );
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("image.adobe.io"));
    assert.ok(adapter.includes("/substance-3d/"));
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
    // long-running guidance points at the poll-interval knob — these jobs always
    // poll by status URL, so it must NOT recommend webhook-timeout tuning (which
    // doesn't apply to image.adobe.io services).
    assert.ok(adapter.includes("ADOBE_JOB_POLL_INTERVAL_MS"));
    assert.ok(
      !adapter.includes("ADOBE_WEBHOOK_TIMEOUT_MS"),
      "must not recommend webhook-timeout tuning (status-URL polled)",
    );
    assert.ok(adapter.includes("export const substance3d"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("validates the format env and interpolates the defaults", async () => {
    const adapter = await read(
      root,
      `${ADOBE}/substance-3d/substance-3d.adapter.ts`,
    );
    assert.ok(adapter.includes("ADOBE_SUBSTANCE_3D_BASE_URL?.trim() ||"));
    assert.ok(
      adapter.includes(
        'rawDefaultFormat === "png" || rawDefaultFormat === "jpg"',
      ),
    );
    assert.ok(adapter.includes('"png"'));
    assert.ok(adapter.includes("render"));
    assert.ok(!adapter.includes("{output_format}"));
    assert.ok(!adapter.includes("{operations}"));
    const env = await read(root, ".env.adobe-substance-3d.example");
    assert.ok(env.includes("ADOBE_SUBSTANCE_3D_FORMAT=png"));
    assert.ok(env.includes("Enabled operations: render"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
