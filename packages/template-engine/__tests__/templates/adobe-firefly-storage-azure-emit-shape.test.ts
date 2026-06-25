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

const STORAGE = "src/infrastructure/adobe/storage";
const ADAPTER = `${STORAGE}/azure-blob-presign.adapter.ts`;

describe("adobe-firefly-storage-azure template — emit shape", () => {
  let root: string;
  let warnings: string[];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-firefly-azure-"));
    const useCase = new AddTemplateUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      defaultsQuestionEngine(),
      new FileSystemFileEmitter(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
    );
    // requires adobe-firefly-core (+ env-setup, error-handling) — auto-resolve.
    const result = await useCase.execute({
      templateIds: ["adobe-firefly-storage-azure"],
      projectRoot: root,
    });
    warnings = result.warnings;
  });

  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it("emits the Azure presigner, registration, and env", async () => {
    for (const rel of [
      ADAPTER,
      `${STORAGE}/azure-register.ts`,
      ".env.adobe-storage-azure.example",
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
    const register = await read(root, `${STORAGE}/azure-register.ts`);
    assert.match(register, /@hexagen-server-only/);
    assert.ok(
      register.includes(
        "setStoragePresigner(new AzureBlobPresignStorageAdapter())",
      ),
    );
    assert.ok(register.includes('from "./passthrough-storage.adapter"'));
    const passthrough = await read(
      root,
      `${STORAGE}/passthrough-storage.adapter.ts`,
    );
    assert.ok(
      !passthrough.includes("azure-blob-presign"),
      "core seam must not import the addon",
    );
  });

  it("mints read SAS for inputs, create/write SAS for outputs; account-key or managed identity", async () => {
    const adapter = await read(root, ADAPTER);
    assert.match(adapter, /@hexagen-server-only/);
    assert.ok(adapter.includes("implements FireflyStoragePort"));
    assert.ok(adapter.includes('from "@azure/storage-blob"'));
    assert.ok(adapter.includes("generateBlobSASQueryParameters"));
    assert.ok(adapter.includes("BlobSASPermissions.parse"));
    // read → "r"; write → create + write
    assert.ok(adapter.includes('action === "read" ? "r" : "cw"'));
    // two signing modes: account key, else managed-identity user-delegation SAS
    assert.ok(adapter.includes("StorageSharedKeyCredential"));
    assert.ok(adapter.includes("DefaultAzureCredential"));
    assert.ok(adapter.includes("getUserDelegationKey"));
    // the user-delegation key is cached on the instance and reused across presigns
    // (one control-plane call per window, not per ref) — getUserDelegationKey is
    // invoked from exactly one place (getDelegationKey), behind the cache.
    assert.ok(adapter.includes("private async getDelegationKey"));
    assert.ok(adapter.includes("this.delegationKey"));
    assert.equal(
      (adapter.match(/getUserDelegationKey\(/g) || []).length,
      1,
      "getUserDelegationKey must be called from a single cached path, not per presign",
    );
    // getService returns a statically non-optional client (a local) for strict TS
    assert.ok(adapter.includes("private getService"));
    assert.ok(adapter.includes("const created ="));
    assert.ok(adapter.includes("return created"));
    // reject path traversal so a ref can't escape the prefix
    assert.ok(adapter.includes("path traversal"));
  });

  it("reads config at presign time, captures no env in the constructor", async () => {
    const adapter = await read(root, ADAPTER);
    // env is read at call time via requireEnv / process.env, not snapshotted
    assert.ok(adapter.includes("process.env[name]?.trim()"));
    assert.ok(adapter.includes("ADOBE_AZURE_STORAGE_ACCOUNT"));
    assert.ok(adapter.includes("ADOBE_AZURE_CONTAINER"));
    assert.ok(adapter.includes("process.env.ADOBE_AZURE_STORAGE_KEY?.trim()"));
    assert.ok(
      adapter.includes('process.env.ADOBE_AZURE_PREFIX ?? "").replace'),
    );
    const ctorBlock = adapter.slice(
      adapter.indexOf("constructor"),
      adapter.indexOf("private getService"),
    );
    assert.ok(
      !ctorBlock.includes("process.env"),
      "constructor must capture no env (read at presign time / lazy client)",
    );
  });

  it("interpolates and clamps the SAS lifetime", async () => {
    const adapter = await read(root, ADAPTER);
    assert.ok(adapter.includes('Number("900")'));
    assert.ok(!adapter.includes("{url_expiry_seconds}"));
    assert.ok(adapter.includes("resolveExpiry"));
    assert.ok(adapter.includes("604_800") || adapter.includes("604800"));
    assert.ok(adapter.includes("Math.max(1"));
  });

  it("marks account + container required in the env example", async () => {
    const env = await read(root, ".env.adobe-storage-azure.example");
    assert.match(env, /ADOBE_AZURE_STORAGE_ACCOUNT=\s*#\s*required/);
    assert.match(env, /ADOBE_AZURE_CONTAINER=\s*#\s*required/);
  });

  it("leaves no unresolved template variables", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });
});
