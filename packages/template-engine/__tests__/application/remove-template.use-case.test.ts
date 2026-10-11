import { describe, it, expect, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { RemoveTemplateUseCase } from "../../src/application/use-cases/remove-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemProjectRemovalFiles } from "../../src/infrastructure/project-removal-files.adapter.js";
import { TEMPLATE_CONFIG_FILE } from "../../src/domain/index.js";
import type { TemplateManifest } from "../../src/domain/index.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";
import type { ProjectRemovalFilesPort } from "../../src/application/ports/project-removal-files.port.js";

// RemoveTemplateUseCase deletes files in a user's project. Every test
// works only inside its own fs.mkdtemp directory, removed in afterEach.
describe("RemoveTemplateUseCase", () => {
  const worlds: string[] = [];

  afterEach(async () => {
    for (const dir of worlds.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  const ONE = "one-content\n";
  const TWO = "two-content\n";
  const OTHER = "other-content\n";
  const SHARED = "shared-content\n";
  const PLAIN = "plain-content\n";

  function manifest(
    id: string,
    outputs: string[],
    extra: Partial<TemplateManifest> = {},
  ): TemplateManifest {
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
      ...extra,
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

  interface World {
    dir: string;
    projectRoot: string;
    registry: TemplateRegistryPort;
    configStore: FileSystemTemplateConfigStore;
    removalFiles: FileSystemProjectRemovalFiles;
    add: () => AddTemplateUseCase;
    remove: () => RemoveTemplateUseCase;
  }

  // A world: one mkdtemp directory holding the template sources, the
  // project root and anything a test keeps outside the project.
  async function makeWorld(
    manifests: TemplateManifest[],
    templateFiles: Record<string, string>,
  ): Promise<World> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-remove-uc-"));
    worlds.push(dir);
    const templatesDir = path.join(dir, "templates");
    for (const [rel, content] of Object.entries(templateFiles)) {
      const abs = path.join(templatesDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf-8");
    }
    const projectRoot = path.join(dir, "project");
    await fs.mkdir(projectRoot, { recursive: true });
    const registry = stubRegistry(manifests);
    const configStore = new FileSystemTemplateConfigStore();
    const removalFiles = new FileSystemProjectRemovalFiles();
    return {
      dir,
      projectRoot,
      registry,
      configStore,
      removalFiles,
      add: () =>
        new AddTemplateUseCase(
          registry,
          silentQuestionEngine(),
          new FileSystemFileEmitter(templatesDir),
          configStore,
        ),
      remove: () =>
        new RemoveTemplateUseCase(registry, configStore, removalFiles),
    };
  }

  async function readRegistryFile(projectRoot: string): Promise<string> {
    return fs.readFile(path.join(projectRoot, TEMPLATE_CONFIG_FILE), "utf-8");
  }

  // The whole project tree, paths and bytes, for the nothing-changed checks.
  async function snapshotTree(root: string): Promise<Record<string, string>> {
    const snap: Record<string, string> = {};
    async function walk(rel: string): Promise<void> {
      const entries = await fs.readdir(path.join(root, rel), {
        withFileTypes: true,
      });
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(childRel);
        } else {
          snap[childRel] = (
            await fs.readFile(path.join(root, childRel))
          ).toString("base64");
        }
      }
    }
    await walk("");
    return snap;
  }

  it("removes the template's files, prunes the folders it left empty, drops the entry, and leaves another template's entry byte-identical", async () => {
    const world = await makeWorld(
      [
        manifest("t", ["dir/one.txt", "dir/sub/two.txt"], {
          checklist: ["run the tests"],
        }),
        manifest("other", ["other.txt"]),
      ],
      {
        "t/files/dir/one.txt": ONE,
        "t/files/dir/sub/two.txt": TWO,
        "other/files/other.txt": OTHER,
      },
    );

    await world.add().execute({
      templateIds: ["t", "other"],
      projectRoot: world.projectRoot,
    });
    const before = JSON.parse(await readRegistryFile(world.projectRoot));
    const otherEntryBefore = JSON.stringify(before.templates.other);

    // A conflict copy beside a recorded file: listed, never deleted.
    await fs.writeFile(
      path.join(world.projectRoot, "dir/one.hexagen-update.txt"),
      "conflict\n",
      "utf-8",
    );

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });

    assert.equal(result.kind, "removed");
    expect(result.deleted).toEqual(["dir/one.txt", "dir/sub/two.txt"]);
    expect(result.prunedDirs).toEqual(["dir/sub"]);
    expect(result.conflictCopies).toEqual(["dir/one.hexagen-update.txt"]);
    expect(result.checklist).toEqual(["run the tests"]);
    expect(result.derivedAnswerWarnings).toEqual([]);
    assert.equal(result.registrySaved, true);

    await assert.rejects(
      fs.access(path.join(world.projectRoot, "dir/one.txt")),
    );
    await assert.rejects(
      fs.access(path.join(world.projectRoot, "dir/sub/two.txt")),
    );
    // `dir` holds the kept conflict copy, so it is not pruned.
    assert.equal(
      (await fs.stat(path.join(world.projectRoot, "dir"))).isDirectory(),
      true,
    );
    // The conflict copy survives beside the deleted file.
    assert.equal(
      await fs.readFile(
        path.join(world.projectRoot, "dir/one.hexagen-update.txt"),
        "utf-8",
      ),
      "conflict\n",
    );

    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
    assert.equal(JSON.stringify(after.templates.other), otherEntryBefore);
  });

  it("keeps a changed file without --force and deletes it with --force", async () => {
    const manifests = [manifest("t", ["a.txt", "b.txt"])];
    const files = {
      "t/files/a.txt": "a-original\n",
      "t/files/b.txt": "b-original\n",
    };
    const USER_TEXT = "the user rewrote this\n";

    const kept = await makeWorld(manifests, files);
    await kept.add().execute({
      templateIds: ["t"],
      projectRoot: kept.projectRoot,
    });
    await fs.writeFile(
      path.join(kept.projectRoot, "a.txt"),
      USER_TEXT,
      "utf-8",
    );

    const keptResult = await kept.remove().execute({
      projectRoot: kept.projectRoot,
      templateId: "t",
    });
    assert.equal(keptResult.kind, "removed");
    expect(keptResult.deleted).toEqual(["b.txt"]);
    expect(keptResult.keptChanged).toEqual(["a.txt"]);
    assert.equal(
      await fs.readFile(path.join(kept.projectRoot, "a.txt"), "utf-8"),
      USER_TEXT,
    );
    await assert.rejects(fs.access(path.join(kept.projectRoot, "b.txt")));
    const keptRegistry = JSON.parse(await readRegistryFile(kept.projectRoot));
    assert.equal(Object.hasOwn(keptRegistry.templates, "t"), false);

    const forced = await makeWorld(manifests, files);
    await forced.add().execute({
      templateIds: ["t"],
      projectRoot: forced.projectRoot,
    });
    await fs.writeFile(
      path.join(forced.projectRoot, "a.txt"),
      USER_TEXT,
      "utf-8",
    );

    const forcedResult = await forced.remove().execute({
      projectRoot: forced.projectRoot,
      templateId: "t",
      force: true,
    });
    assert.equal(forcedResult.kind, "removed");
    expect(forcedResult.deleted).toEqual(["a.txt", "b.txt"]);
    expect(forcedResult.deleteChanged).toEqual(["a.txt"]);
    expect(forcedResult.keptChanged).toEqual([]);
    await assert.rejects(fs.access(path.join(forced.projectRoot, "a.txt")));
  });

  it("keeps a file another installed template also records", async () => {
    const world = await makeWorld(
      [
        manifest("t", ["shared.txt", "t.txt"]),
        manifest("u", ["shared.txt", "u.txt"]),
      ],
      {
        "t/files/shared.txt": SHARED,
        "t/files/t.txt": "t-only\n",
        "u/files/shared.txt": SHARED,
        "u/files/u.txt": "u-only\n",
      },
    );
    await world.add().execute({
      templateIds: ["t", "u"],
      projectRoot: world.projectRoot,
    });

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(result.kind, "removed");
    expect(result.keptShared).toEqual(["shared.txt"]);
    expect(result.deleted).toEqual(["t.txt"]);
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "shared.txt"), "utf-8"),
      SHARED,
    );
    await assert.rejects(fs.access(path.join(world.projectRoot, "t.txt")));
  });

  it("refuses while another installed template requires this one, and --force lists the dependent as broken", async () => {
    const world = await makeWorld(
      [
        manifest("base", ["base.txt"]),
        manifest("child", ["child.txt"], { requires: ["base"] }),
      ],
      {
        "base/files/base.txt": "base-content\n",
        "child/files/child.txt": "child-content\n",
      },
    );
    await world.add().execute({
      templateIds: ["base", "child"],
      projectRoot: world.projectRoot,
    });
    const registryBefore = await readRegistryFile(world.projectRoot);

    const refusal = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "base",
    });
    assert.equal(refusal.kind, "refused");
    expect(refusal.refusals).toEqual([
      { kind: "dependents", templates: ["child"] },
    ]);
    // Nothing was touched: file, folders and registry byte-identical.
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "base.txt"), "utf-8"),
      "base-content\n",
    );
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);

    const forced = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "base",
      force: true,
    });
    assert.equal(forced.kind, "removed");
    expect(forced.brokenDependents).toEqual(["child"]);
    expect(forced.deleted).toEqual(["base.txt"]);
    await assert.rejects(fs.access(path.join(world.projectRoot, "base.txt")));
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "base"), false);
    assert.equal(Object.hasOwn(after.templates, "child"), true);
  });

  it("--keep-files removes the entry only and leaves every file", async () => {
    const world = await makeWorld(
      [manifest("t", ["k/deep/k.txt", "plain.txt"])],
      {
        "t/files/k/deep/k.txt": "k-content\n",
        "t/files/plain.txt": PLAIN,
      },
    );
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
      keepFiles: true,
    });
    assert.equal(result.kind, "removed");
    expect(result.deleteFiles).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.keptByFlag).toEqual(["k/deep/k.txt", "plain.txt"]);
    expect(result.prunedDirs).toEqual([]);
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "k/deep/k.txt"), "utf-8"),
      "k-content\n",
    );
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "plain.txt"), "utf-8"),
      PLAIN,
    );
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });

  it("--dry-run reports the plan, the conflict copies included, and changes nothing", async () => {
    const world = await makeWorld([manifest("t", ["d/deep/f.txt"])], {
      "t/files/d/deep/f.txt": "f-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    await fs.writeFile(
      path.join(world.projectRoot, "d/deep/f.hexagen-update.txt"),
      "conflict\n",
      "utf-8",
    );
    const treeBefore = await snapshotTree(world.projectRoot);
    const registryBefore = await readRegistryFile(world.projectRoot);

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
      dryRun: true,
    });
    assert.equal(result.kind, "dry-run");
    expect(result.deleteFiles).toEqual(["d/deep/f.txt"]);
    expect(result.conflictCopies).toEqual(["d/deep/f.hexagen-update.txt"]);

    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
  });

  it("refuses a registry naming a path outside the project, and the sentinel survives", async () => {
    const world = await makeWorld([manifest("t", ["ok.txt"])], {
      "t/files/ok.txt": "ok-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const SENTINEL = "sentinel-content\n";
    await fs.writeFile(path.join(world.dir, "outside.txt"), SENTINEL, "utf-8");
    // A hand-edited registry that names a file outside the project.
    const config = await world.configStore.load(world.projectRoot);
    config.templates.t.generatedFiles.push({
      path: "../outside.txt",
      contentHash: "whatever",
    });
    await world.configStore.save(world.projectRoot, config);
    const registryBefore = await readRegistryFile(world.projectRoot);

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(result.kind, "refused");
    expect(result.refusals).toEqual([
      { kind: "unsafe-paths", paths: ["../outside.txt"] },
    ]);
    assert.equal(
      await fs.readFile(path.join(world.dir, "outside.txt"), "utf-8"),
      SENTINEL,
    );
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "ok.txt"), "utf-8"),
      "ok-content\n",
    );
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
  });

  it("a save that throws leaves the files deleted and the entry present, and a second run completes the job", async () => {
    const world = await makeWorld(
      [manifest("t", ["s/inner/x.txt", "s/y.txt"])],
      {
        "t/files/s/inner/x.txt": "x-content\n",
        "t/files/s/y.txt": "y-content\n",
      },
    );
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const failingStore: typeof world.configStore = Object.create(
      world.configStore,
    );
    failingStore.save = async () => {
      throw new Error("disk full");
    };
    const failing = new RemoveTemplateUseCase(
      world.registry,
      failingStore,
      world.removalFiles,
    );

    await assert.rejects(
      failing.execute({ projectRoot: world.projectRoot, templateId: "t" }),
      /disk full/,
    );
    // The files are gone (and the folders pruned), but the entry remains.
    await assert.rejects(
      fs.access(path.join(world.projectRoot, "s/inner/x.txt")),
    );
    await assert.rejects(fs.access(path.join(world.projectRoot, "s/y.txt")));
    await assert.rejects(fs.access(path.join(world.projectRoot, "s")));
    const mid = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(mid.templates, "t"), true);

    const second = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(second.kind, "removed");
    expect(second.deleted).toEqual([]);
    expect(second.alreadyAbsent).toEqual(["s/inner/x.txt", "s/y.txt"]);
    assert.equal(second.registrySaved, true);
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });

  it("removing twice reports not-installed the second time", async () => {
    const world = await makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": ONE,
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const first = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(first.kind, "removed");
    const second = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(second.kind, "not-installed");
  });

  it("answers no-registry without --force and not-installed with it", async () => {
    const world = await makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": ONE,
    });
    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(result.kind, "no-registry");
    const forced = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "t",
      force: true,
    });
    assert.equal(forced.kind, "not-installed");
  });

  it("lets a schema fault from loadState propagate", async () => {
    const world = await makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": ONE,
    });
    await fs.writeFile(
      path.join(world.projectRoot, TEMPLATE_CONFIG_FILE),
      JSON.stringify({ schemaVersion: "1" }),
      "utf-8",
    );
    await assert.rejects(
      world.remove().execute({
        projectRoot: world.projectRoot,
        templateId: "t",
      }),
      /not readable as a config/,
    );
  });

  it("warns about installed templates whose auto questions derive from the removed one", async () => {
    const world = await makeWorld(
      [
        manifest("base", ["base.txt"], {
          questions: [
            {
              id: "framework",
              type: "select",
              prompt: "Which?",
              options: ["a", "b"],
              default: "a",
            },
          ],
        }),
        manifest("child", ["child.txt"], {
          questions: [
            {
              id: "fw",
              type: "auto",
              derivedFrom: "base.framework",
              default: "",
            },
          ],
        }),
      ],
      {
        "base/files/base.txt": "base-content\n",
        "child/files/child.txt": "child-content\n",
      },
    );
    await world.add().execute({
      templateIds: ["base", "child"],
      projectRoot: world.projectRoot,
      overrideAnswers: { base: { framework: "a" } },
    });

    const result = await world.remove().execute({
      projectRoot: world.projectRoot,
      templateId: "base",
    });
    assert.equal(result.kind, "removed");
    expect(result.derivedAnswerWarnings).toEqual(["child"]);
    expect(result.checklist).toEqual([]);
  });

  it("keeps a file that changed after the plan was made, listing it as skipped at delete", async () => {
    const world = await makeWorld([manifest("t", ["r.txt"])], {
      "t/files/r.txt": "r-original\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    // The file changes between inspect and deleteFiles: the plan is stale,
    // the adapter re-hashes immediately before unlinking and skips.
    const racing: ProjectRemovalFilesPort = {
      inspect: async (root, paths) => {
        const states = await world.removalFiles.inspect(root, paths);
        await fs.writeFile(path.join(root, "r.txt"), "changed-late\n", "utf-8");
        return states;
      },
      deleteFiles: (root, requests) =>
        world.removalFiles.deleteFiles(root, requests),
      pruneEmptyDirs: (root, deleted) =>
        world.removalFiles.pruneEmptyDirs(root, deleted),
      existingConflictCopies: (root, paths) =>
        world.removalFiles.existingConflictCopies(root, paths),
    };
    const useCase = new RemoveTemplateUseCase(
      world.registry,
      world.configStore,
      racing,
    );

    const result = await useCase.execute({
      projectRoot: world.projectRoot,
      templateId: "t",
    });
    assert.equal(result.kind, "removed");
    expect(result.deleted).toEqual([]);
    expect(result.skippedAtDelete).toEqual([
      { path: "r.txt", reason: "changed" },
    ]);
    expect(result.keptChanged).toEqual(["r.txt"]);
    assert.equal(
      await fs.readFile(path.join(world.projectRoot, "r.txt"), "utf-8"),
      "changed-late\n",
    );
    assert.equal(result.registrySaved, true);
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });
});
