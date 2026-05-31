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

describe("adobe-firefly-composite template — emit shape", () => {
  let root: string;
  let warnings: string[];

  before(async () => {
    root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-firefly-composite-"),
    );
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-composite"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the composite port, adapter, and env", async () => {
    for (const rel of [
      `${PORTS}/composite.port.ts`,
      `${ADOBE}/composite/composite.adapter.ts`,
      ".env.adobe-composite.example",
    ]) {
      assert.ok(await exists(root, rel), `expected ${rel}`);
    }
  });

  it("auto-resolves the adobe-firefly-core foundation", async () => {
    assert.ok(await exists(root, `${ADOBE}/http/firefly-client.ts`));
    assert.ok(await exists(root, `${ADOBE}/jobs/job-port.ts`));
  });

  it("returns an array of candidates and types failures without infra coupling", async () => {
    const port = await read(root, `${PORTS}/composite.port.ts`);
    assert.ok(port.includes("interface CompositePort"));
    assert.ok(port.includes("composite(req: CompositeRequest)"));
    assert.ok(port.includes("Promise<Result<string[], FireflyError>>"));
    assert.match(port, /import type \{\s*FireflyError\s*\}/);
    assert.ok(
      !/^import \{[^}]*FireflyError/m.test(port),
      "must not value-import FireflyError",
    );
  });

  it("presigns product + scene + output, targets the async endpoint, returns candidates", async () => {
    const adapter = await read(root, `${ADOBE}/composite/composite.adapter.ts`);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("presignInput(req.productHref)"));
    assert.ok(adapter.includes("presignInput(req.sceneHref)"));
    assert.ok(adapter.includes("presignOutput(req.outputHref)"));
    // async endpoint (returns a job to await) — not the sync variant
    assert.ok(adapter.includes("/v3/images/composite-async"));
    assert.ok(
      !/"\/v3\/images\/composite"/.test(adapter),
      "must not call the sync endpoint",
    );
    assert.ok(adapter.includes("toJobHandle("));
    assert.ok(adapter.includes("if (!handle.jobId)"));
    assert.ok(adapter.includes("jobPort.await(handle)"));
    assert.ok(adapter.includes('storage: "external"'));
    // policy flags pass through
    assert.ok(adapter.includes("req.contentCredentials"));
    assert.ok(adapter.includes("req.safety"));
    // returns the full candidate array
    assert.ok(adapter.includes("done.outputs"));
    assert.ok(
      adapter.includes("return ok(") && adapter.includes("return err("),
    );
  });

  it("hardens model + candidate count against empty/invalid env, and interpolates the default", async () => {
    const adapter = await read(root, `${ADOBE}/composite/composite.adapter.ts`);
    assert.ok(adapter.includes("ADOBE_FIREFLY_DEFAULT_MODEL?.trim() ||"));
    assert.ok(adapter.includes("resolveCandidates"));
    assert.ok(adapter.includes("Number.isInteger"));
    assert.ok(adapter.includes('Number("2")'));
    assert.ok(!adapter.includes("{default_candidates}"));
    const env = await read(root, ".env.adobe-composite.example");
    assert.ok(env.includes("ADOBE_COMPOSITE_CANDIDATES=2"));
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
