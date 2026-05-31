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

const STORAGE = "src/infrastructure/adobe/storage";

describe("adobe-firefly-storage-gcs template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-gcs-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-storage-gcs"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the GCS presigner, registration, and env", async () => {
    for (const rel of [
      `${STORAGE}/gcs-presign.adapter.ts`,
      `${STORAGE}/gcs-register.ts`,
      ".env.adobe-storage-gcs.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the core storage seam", async () => {
    const passthrough = await read(
      root,
      `${STORAGE}/passthrough-storage.adapter.ts`,
    );
    assert.ok(passthrough.includes("export function setStoragePresigner"));
  });

  it("registers via the seam as a side-effect import (no static import of the addon)", async () => {
    const register = await read(root, `${STORAGE}/gcs-register.ts`);
    assert.match(register, /@hexagen-server-only/);
    assert.ok(
      register.includes("setStoragePresigner(new GcsPresignStorageAdapter())"),
    );
    assert.ok(register.includes('from "./passthrough-storage.adapter"'));
    // the core seam file must not import the addon back
    const passthrough = await read(
      root,
      `${STORAGE}/passthrough-storage.adapter.ts`,
    );
    assert.ok(
      !passthrough.includes("gcs-presign"),
      "core seam must not import the addon",
    );
  });

  it("signs V4 read for inputs, write for outputs; credentials via ADC (never hardcoded)", async () => {
    const adapter = await read(root, `${STORAGE}/gcs-presign.adapter.ts`);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("implements FireflyStoragePort"));
    assert.ok(adapter.includes('from "@google-cloud/storage"'));
    assert.ok(adapter.includes("getSignedUrl"));
    assert.ok(adapter.includes('version: "v4"'));
    assert.ok(adapter.includes('"read"') && adapter.includes('"write"'));
    // credentials/project come from the ADC chain — never a hardcoded key file
    assert.ok(adapter.includes("new Storage()"));
    assert.ok(
      !adapter.includes("keyFilename") && !adapter.includes("credentials:"),
      "must rely on ADC, not hardcoded credentials",
    );
    // bucket validation is DEFERRED to presign time (import must not crash startup)
    assert.ok(adapter.includes('process.env.ADOBE_GCS_BUCKET ?? ""'));
    assert.ok(adapter.includes("requireBucket"));
    assert.ok(adapter.includes("ADOBE_GCS_BUCKET is not set"));
    const ctorBlock = adapter.slice(
      adapter.indexOf("constructor"),
      adapter.indexOf("async presignInput"),
    );
    assert.ok(
      !ctorBlock.includes("ADOBE_GCS_BUCKET is not set"),
      "constructor must not throw on a missing bucket",
    );
    // reject path traversal so a ref can't escape the prefix
    assert.ok(adapter.includes("path traversal"));
    // prefix normalised (no leading "/") so object names never start with "/"
    assert.ok(adapter.includes('process.env.ADOBE_GCS_PREFIX ?? "").replace'));
  });

  it("interpolates and clamps the presigned-URL lifetime", async () => {
    const adapter = await read(root, `${STORAGE}/gcs-presign.adapter.ts`);
    assert.ok(adapter.includes('Number("900")'));
    assert.ok(!adapter.includes("{url_expiry_seconds}"));
    // a bad/overridden value can't reach getSignedUrl as NaN/out-of-range
    assert.ok(adapter.includes("resolveExpiry"));
    assert.ok(adapter.includes("604_800") || adapter.includes("604800"));
    // clamped to >= 1 after flooring (0.5 would floor to 0, out of range)
    assert.ok(adapter.includes("Math.max(1"));
  });

  it("marks the bucket required in the env example", async () => {
    const env = await read(root, ".env.adobe-storage-gcs.example");
    assert.match(env, /ADOBE_GCS_BUCKET=\s*#\s*required/);
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
