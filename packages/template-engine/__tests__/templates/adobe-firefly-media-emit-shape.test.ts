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
const ADAPTER = `${ADOBE}/media/firefly-media.adapter.ts`;

describe("adobe-firefly-media template — emit shape", () => {
  let root: string;
  let warnings: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-media-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-media"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the media port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/media-generation.port.ts`,
      ADAPTER,
      ".env.adobe-media.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares a method per operation without infra coupling", async () => {
    const port = await read(root, `${PORTS}/media-generation.port.ts`);
    for (const method of [
      "textToVideo",
      "imageToVideo",
      "translateAudioVideo",
      "generateSpeech",
      "soundEffect",
    ]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    // partner/opaque model option
    assert.ok(port.includes("model?:"));
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

  it("targets firefly-api (relative paths) and awaits via the job port (not always-poll)", async () => {
    const adapter = await read(root, ADAPTER);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("implements MediaGenerationPort"));
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes("/v3/videos/"));
    assert.ok(adapter.includes("/v3/audio/"));
    // translateAudioVideo uses the distinct /v3/audio-video/ path (docs + checklist
    // must list it too — see the manifest/README endpoint guidance).
    assert.ok(adapter.includes("/v3/audio-video/translate-async"));
    // firefly-api job path: await (polling OR webhook), jobId guard — NOT the
    // image.adobe.io always-poll / statusUrl path.
    assert.ok(adapter.includes("jobPort.await(handle)"));
    assert.ok(adapter.includes("if (!handle.jobId)"));
    assert.ok(
      !adapter.includes("jobPort.poll"),
      "media is firefly-api (await), not the image.adobe.io always-poll path",
    );
    // firefly-api uses the core base with RELATIVE /v3 paths — no image.adobe.io
    // host base / normalizeBase (which every image.adobe.io adapter carries).
    assert.ok(
      !adapter.includes("normalizeBase"),
      "media uses the core firefly-api base, not an image.adobe.io host base",
    );
    assert.ok(adapter.includes("export const fireflyMedia"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("resolves the default model from env and interpolates partner_model", async () => {
    const adapter = await read(root, ADAPTER);
    assert.ok(
      adapter.includes("process.env.ADOBE_FIREFLY_MEDIA_MODEL?.trim()"),
    );
    // partner_model boolean (default false) is interpolated, no leftover placeholder
    assert.ok(adapter.includes("partner_model=false"));
    assert.ok(!adapter.includes("{partner_model}"));
    const env = await read(root, ".env.adobe-media.example");
    assert.ok(env.includes("ADOBE_FIREFLY_MEDIA_MODEL="));
    assert.ok(env.includes("partner_model=false"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
