import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import type { TemplateManifest } from "../../src/domain/index.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

// A re-add (`hexagen add <id> --force`) must merge the earlier record's
// generatedFiles with what this run wrote, not replace them: a conflict-skipped
// file or a file this version no longer emits must stay listed so a future
// remove can trust the record.
describe("AddTemplateUseCase — re-add merges generatedFiles", () => {
  let tmpDir: string;
  let templatesDir: string;
  const store = () => new FileSystemTemplateConfigStore();

  const ONE = "one-content\n";
  const TWO = "two-content\n";
  const THREE = "three-content\n";
  const CHANGED_V1 = "changed-v1\n";
  const CHANGED_V2 = "changed-v2\n";

  const sha = (s: string) =>
    crypto.createHash("sha256").update(s, "utf-8").digest("hex");

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-readd-"));
    templatesDir = path.join(tmpDir, "templates");

    const tFiles = path.join(templatesDir, "t", "files");
    await fs.mkdir(tFiles, { recursive: true });
    await fs.writeFile(path.join(tFiles, "one.txt"), ONE, "utf-8");
    await fs.writeFile(path.join(tFiles, "two.txt"), TWO, "utf-8");
    await fs.writeFile(path.join(tFiles, "three.txt"), THREE, "utf-8");

    const changedFiles = path.join(templatesDir, "changed", "files");
    await fs.mkdir(changedFiles, { recursive: true });
    await fs.writeFile(
      path.join(changedFiles, "changed.txt"),
      CHANGED_V1,
      "utf-8",
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function manifest(id: string, outputs: string[]): TemplateManifest {
    return {
      id,
      name: id.toUpperCase(),
      description: "",
      version: "1.0.0",
      requires: [],
      conflicts: [],
      questions: [],
      envVars: [],
      outputs,
      checklist: [],
    };
  }

  function stubRegistry(ms: TemplateManifest[]): TemplateRegistryPort {
    return {
      loadAll: async () => ms,
      loadOne: async (id) => ms.find((m) => m.id === id) ?? null,
    };
  }

  function silentQuestionEngine(): QuestionEnginePort {
    return {
      ask: async (q) => {
        throw new Error(`silentQuestionEngine.ask called for ${q.id}`);
      },
    };
  }

  function makeUseCase(ms: TemplateManifest[]): AddTemplateUseCase {
    return new AddTemplateUseCase(
      stubRegistry(ms),
      silentQuestionEngine(),
      new FileSystemFileEmitter(templatesDir),
      store(),
    );
  }

  async function freshProject(): Promise<string> {
    const dir = path.join(
      tmpDir,
      `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async function readRecord(projectRoot: string, id: string) {
    const config = await store().load(projectRoot);
    return config.templates[id].generatedFiles;
  }

  it("records exactly the two outputs of a first add", async () => {
    const projectRoot = await freshProject();
    const useCase = makeUseCase([manifest("t", ["one.txt", "two.txt"])]);

    const result = await useCase.execute({ templateIds: ["t"], projectRoot });
    assert.deepEqual(result.applied, ["t"]);

    assert.deepEqual(await readRecord(projectRoot, "t"), [
      { path: "one.txt", contentHash: sha(ONE) },
      { path: "two.txt", contentHash: sha(TWO) },
    ]);
  });

  it("keeps exactly two identical records on an unchanged re-add", async () => {
    const projectRoot = await freshProject();
    const ms = [manifest("t", ["one.txt", "two.txt"])];
    const useCase = makeUseCase(ms);

    await useCase.execute({ templateIds: ["t"], projectRoot });
    const first = await readRecord(projectRoot, "t");

    await makeUseCase(ms).execute({
      templateIds: ["t"],
      projectRoot,
      skipInstalled: false,
    });

    assert.deepEqual(await readRecord(projectRoot, "t"), first);
    assert.equal(first.length, 2);
  });

  it("keeps the first run's hash for a file the user changed before a re-add", async () => {
    const projectRoot = await freshProject();
    const ms = [manifest("t", ["one.txt", "two.txt"])];
    const useCase = makeUseCase(ms);

    await useCase.execute({ templateIds: ["t"], projectRoot });
    const first = await readRecord(projectRoot, "t");

    const USER_TEXT = "the user rewrote this\n";
    await fs.writeFile(path.join(projectRoot, "one.txt"), USER_TEXT, "utf-8");

    const second = await makeUseCase(ms).execute({
      templateIds: ["t"],
      projectRoot,
      skipInstalled: false,
    });

    // The emitter took its conflict path for one.txt: a warning, and the new
    // content beside the user's file.
    assert.equal(
      second.warnings.some((w) => w.includes("one.txt")),
      true,
    );
    await fs.access(path.join(projectRoot, "one.hexagen-update.txt"));

    // The record still lists both paths, byte-for-byte as the first run
    // recorded them — including one.txt's first-run hash, which is NOT the
    // hash of what is on disk now.
    assert.deepEqual(await readRecord(projectRoot, "t"), first);
    assert.notEqual(first[0].contentHash, sha(USER_TEXT));

    // The file on disk still has the user's content (a conflict copy was
    // written instead).
    assert.equal(
      await fs.readFile(path.join(projectRoot, "one.txt"), "utf-8"),
      USER_TEXT,
    );
  });

  it("keeps a file the new template version no longer emits", async () => {
    const projectRoot = await freshProject();
    const useCase = makeUseCase([manifest("t", ["one.txt", "two.txt"])]);

    await useCase.execute({ templateIds: ["t"], projectRoot });

    // Same id, new version: outputs are now two.txt and three.txt.
    await makeUseCase([manifest("t", ["two.txt", "three.txt"])]).execute({
      templateIds: ["t"],
      projectRoot,
      skipInstalled: false,
    });

    assert.deepEqual(await readRecord(projectRoot, "t"), [
      { path: "one.txt", contentHash: sha(ONE) },
      { path: "two.txt", contentHash: sha(TWO) },
      { path: "three.txt", contentHash: sha(THREE) },
    ]);
  });

  it("takes the new hash when the template source content changed", async () => {
    const projectRoot = await freshProject();
    const ms = [manifest("changed", ["changed.txt"])];
    const useCase = makeUseCase(ms);

    await useCase.execute({ templateIds: ["changed"], projectRoot });
    assert.deepEqual(await readRecord(projectRoot, "changed"), [
      { path: "changed.txt", contentHash: sha(CHANGED_V1) },
    ]);

    // The template source changed; the user did not touch the emitted file.
    await fs.writeFile(
      path.join(templatesDir, "changed", "files", "changed.txt"),
      CHANGED_V2,
      "utf-8",
    );

    await makeUseCase(ms).execute({
      templateIds: ["changed"],
      projectRoot,
      skipInstalled: false,
    });

    // One record for the path, with the NEW hash; disk has the new content.
    assert.deepEqual(await readRecord(projectRoot, "changed"), [
      { path: "changed.txt", contentHash: sha(CHANGED_V2) },
    ]);
    assert.equal(
      await fs.readFile(path.join(projectRoot, "changed.txt"), "utf-8"),
      CHANGED_V2,
    );
  });

  it("leaves the record untouched when skipInstalled keeps the default", async () => {
    const projectRoot = await freshProject();
    const ms = [manifest("t", ["one.txt", "two.txt"])];
    const useCase = makeUseCase(ms);

    await useCase.execute({ templateIds: ["t"], projectRoot });
    const first = await readRecord(projectRoot, "t");

    const result = await makeUseCase(ms).execute({
      templateIds: ["t"],
      projectRoot,
    });

    assert.deepEqual(result.skipped, ["t"]);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(await readRecord(projectRoot, "t"), first);
  });
});
