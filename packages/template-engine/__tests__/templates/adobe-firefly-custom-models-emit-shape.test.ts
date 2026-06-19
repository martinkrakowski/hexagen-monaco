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
const ADAPTER = `${ADOBE}/custom-models/firefly-custom-model.adapter.ts`;

describe("adobe-firefly-custom-models template — emit shape", () => {
  let root: string;
  let warnings: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-cm-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-custom-models"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the custom-model port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/custom-model.port.ts`,
      ADAPTER,
      ".env.adobe-custom-models.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("declares the train/status/list/generateWith lifecycle without infra coupling", async () => {
    const port = await read(root, `${PORTS}/custom-model.port.ts`);
    for (const method of ["train", "status", "list", "generateWith"]) {
      assert.ok(port.includes(`${method}(`), `port must declare ${method}`);
    }
    assert.ok(port.includes("CustomModelStatus"));
    assert.ok(port.includes("TrainedModel"));
    // unrecognised API statuses are surfaced as "unknown" (not guessed as queued/failed)
    assert.ok(port.includes('"unknown"'));
    const adapter = await read(root, ADAPTER);
    assert.ok(
      adapter.includes('return "unknown"'),
      "normaliseStatus default must be unknown",
    );
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("trains + infers on firefly-api, awaiting via the job port (not always-poll)", async () => {
    const adapter = await read(root, ADAPTER);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("implements CustomModelPort"));
    assert.ok(adapter.includes("getStoragePresigner()"));
    assert.ok(adapter.includes("fireflyClient.post("));
    assert.ok(adapter.includes("fireflyClient.get<"));
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes("/v3/custom-models/train-async"));
    assert.ok(adapter.includes("/v3/custom-models"));
    assert.ok(adapter.includes("/v3/images/generate-async"));
    // firefly-api job path: await (polling OR webhook), jobId guard — NOT the
    // other-host always-poll / normalizeBase path.
    assert.ok(adapter.includes("jobPort.await(handle)"));
    assert.ok(adapter.includes("if (!handle.jobId)"));
    assert.ok(
      !adapter.includes("jobPort.poll"),
      "custom-models is firefly-api (await), not the always-poll path",
    );
    assert.ok(
      !adapter.includes("normalizeBase"),
      "firefly-api uses the core base, not an other-host base",
    );
    assert.ok(adapter.includes("export const fireflyCustomModel"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
    // status() must not return ok with an empty/unusable model id; list() filters
    // entries without one. toTrainedModel signals the missing id via undefined.
    assert.ok(adapter.includes("TrainedModel | undefined"));
    assert.ok(adapter.includes("had no model id"));
    assert.ok(!adapter.includes('?? ""'), "no empty-string modelId fallback");
  });

  it("resolves the base model from env and interpolates the caption format", async () => {
    const adapter = await read(root, ADAPTER);
    assert.ok(adapter.includes("process.env.ADOBE_FIREFLY_BASE_MODEL?.trim()"));
    // dataset_caption_format (jsonl default) is interpolated, no leftover placeholder
    assert.ok(adapter.includes('DATASET_CAPTION_FORMAT = "jsonl"'));
    assert.ok(!adapter.includes("{dataset_caption_format}"));
    const env = await read(root, ".env.adobe-custom-models.example");
    assert.ok(env.includes("ADOBE_FIREFLY_BASE_MODEL="));
    assert.ok(env.includes("install (jsonl)"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
