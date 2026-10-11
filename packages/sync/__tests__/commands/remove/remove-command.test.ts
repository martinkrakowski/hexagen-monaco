import { describe, it, expect, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import {
  AddTemplateUseCase,
  RemoveTemplateUseCase,
  FileSystemFileEmitter,
  FileSystemTemplateConfigStore,
  FileSystemProjectRemovalFiles,
  TEMPLATE_CONFIG_FILE,
} from "@hexagen/template-engine";
import type { TemplateManifest } from "@hexagen/template-engine";
import type { TemplateRegistryPort } from "@hexagen/template-engine";
import type { QuestionEnginePort } from "@hexagen/template-engine";
import {
  runRemoveTemplate,
  formatRemovalPlan,
  formatRemovalOutcome,
} from "../../../src/commands/remove/index.js";
import type { RemoveCommandDeps } from "../../../src/commands/remove/index.js";
import type { RemoveTemplateResult } from "@hexagen/template-engine";

// `hexagen remove` deletes files in a user's project. Every test works
// only inside its own fs.mkdtemp directory, removed in afterEach, and
// never calls process.chdir or process.exit.
describe("remove command", () => {
  const worlds: string[] = [];

  afterEach(() => {
    for (const dir of worlds.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
    templatesDir: string;
    registry: TemplateRegistryPort;
    configStore: FileSystemTemplateConfigStore;
    removalFiles: FileSystemProjectRemovalFiles;
    add: () => AddTemplateUseCase;
    remove: () => RemoveTemplateUseCase;
    logs: string[];
    errors: string[];
    confirm: ReturnType<typeof vi.fn>;
    deps: (overrides?: Partial<RemoveCommandDeps>) => RemoveCommandDeps;
  }

  // A world: one mkdtemp directory holding the template sources, the
  // project root and anything a test keeps outside the project.
  function makeWorld(
    manifests: TemplateManifest[],
    templateFiles: Record<string, string>,
  ): World {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hexagen-remove-cmd-"));
    worlds.push(dir);
    const templatesDir = path.join(dir, "templates");
    for (const [rel, content] of Object.entries(templateFiles)) {
      const abs = path.join(templatesDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf-8");
    }
    const projectRoot = path.join(dir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const registry = stubRegistry(manifests);
    const configStore = new FileSystemTemplateConfigStore();
    const removalFiles = new FileSystemProjectRemovalFiles();
    const logs: string[] = [];
    const errors: string[] = [];
    const confirmFn = vi.fn(async () => true);
    const world: World = {
      dir,
      projectRoot,
      templatesDir,
      registry,
      configStore,
      removalFiles,
      logs,
      errors,
      confirm: confirmFn,
      add: () =>
        new AddTemplateUseCase(
          registry,
          silentQuestionEngine(),
          new FileSystemFileEmitter(templatesDir),
          configStore,
        ),
      remove: () =>
        new RemoveTemplateUseCase(registry, configStore, removalFiles),
      deps: (overrides) => ({
        projectRoot,
        useCase: new RemoveTemplateUseCase(registry, configStore, removalFiles),
        log: (line) => {
          logs.push(line);
        },
        error: (line) => {
          errors.push(line);
        },
        isInteractive: true,
        confirm: confirmFn,
        ...overrides,
      }),
    };
    return world;
  }

  async function readRegistryFile(projectRoot: string): Promise<string> {
    return fsp.readFile(path.join(projectRoot, TEMPLATE_CONFIG_FILE), "utf-8");
  }

  // The whole project tree, paths and bytes, for the nothing-changed checks.
  async function snapshotTree(root: string): Promise<Record<string, string>> {
    const snap: Record<string, string> = {};
    async function walk(rel: string): Promise<void> {
      const entries = await fsp.readdir(path.join(root, rel), {
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
            await fsp.readFile(path.join(root, childRel))
          ).toString("base64");
        }
      }
    }
    await walk("");
    return snap;
  }

  it("answers not installed with exit 0, prints the message, changes nothing, and never asks", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const treeBefore = await snapshotTree(world.projectRoot);
    const registryBefore = await readRegistryFile(world.projectRoot);

    const code = await runRemoveTemplate("missing", {}, world.deps());

    assert.equal(code, 0);
    assert.equal(world.errors.length, 0);
    assert.equal(
      world.logs.some((l) =>
        l.includes("Template 'missing' is not installed. Nothing to remove."),
      ),
      true,
    );
    expect(world.confirm).not.toHaveBeenCalled();
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
  });

  it("no registry with --force answers not installed (exit 0): as built; the decided table lists a missing registry as a refusal", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });

    const code = await runRemoveTemplate("t", {}, world.deps());

    assert.equal(code, 1);
    assert.equal(world.logs.length, 0);
    assert.equal(
      world.errors.some(
        (l) =>
          l.startsWith(
            "No template registry (.hexagen-template-config.json) in ",
          ) && l.endsWith(": nothing is installed here."),
      ),
      true,
    );
    expect(world.confirm).not.toHaveBeenCalled();
    // No registry file was created by the refused removal.
    await assert.rejects(
      fsp.access(path.join(world.projectRoot, TEMPLATE_CONFIG_FILE)),
    );

    const forced = await runRemoveTemplate("t", { force: true }, world.deps());
    assert.equal(forced, 0);
    assert.equal(
      world.logs.some((l) =>
        l.includes("Template 't' is not installed. Nothing to remove."),
      ),
      true,
    );
    await assert.rejects(
      fsp.access(path.join(world.projectRoot, TEMPLATE_CONFIG_FILE)),
    );
  });

  const EMPTY_PLAN: Extract<RemoveTemplateResult, { kind: "dry-run" }> = {
    kind: "dry-run",
    templateId: "t",
    deleteFiles: [],
    deleteChanged: [],
    keptChanged: [],
    keptShared: [],
    keptOther: [],
    keptByFlag: [],
    alreadyAbsent: [],
    brokenDependents: [],
    unknownDependents: [],
    malformedRecords: 0,
    conflictCopies: [],
  };

  const EMPTY_OUTCOME: Extract<RemoveTemplateResult, { kind: "removed" }> = {
    ...EMPTY_PLAN,
    kind: "removed",
    deleted: [],
    skippedAtDelete: [],
    prunedDirs: [],
    checklist: [],
    derivedAnswerWarnings: [],
  };

  it("formatRemovalPlan prints no section header for an empty list", () => {
    assert.deepEqual(formatRemovalPlan(EMPTY_PLAN), [
      "The registry entry of 't' will be removed.",
    ]);
  });

  it("formatRemovalPlan names every list in its section, in order", () => {
    const lines = formatRemovalPlan({
      ...EMPTY_PLAN,
      deleteFiles: ["a.txt", "changed.txt", "z.txt"],
      deleteChanged: ["changed.txt"],
      keptChanged: ["k-changed.txt"],
      keptShared: ["k-shared.txt"],
      keptOther: ["k-other.txt"],
      keptByFlag: ["k-flag.txt"],
      alreadyAbsent: ["gone.txt"],
      conflictCopies: ["a.hexagen-update.txt"],
      brokenDependents: ["child"],
      unknownDependents: ["mystery"],
      malformedRecords: 2,
    });
    assert.deepEqual(lines, [
      "Will delete (unchanged since install):",
      "  a.txt",
      "  z.txt",
      "Will delete although CHANGED since install (--force):",
      "  changed.txt",
      "Kept: changed since install:",
      "  k-changed.txt",
      "Kept: also recorded by another installed template:",
      "  k-shared.txt",
      "Kept: not a plain file, or unreadable:",
      "  k-other.txt",
      "Kept: --keep-files:",
      "  k-flag.txt",
      "Already absent (their records leave the registry):",
      "  gone.txt",
      "Conflict copies beside these files (listed, NOT deleted):",
      "  a.hexagen-update.txt",
      "WARNING: these installed templates require 't' and will be broken (--force):",
      "  child",
      "WARNING: these installed templates could not be read and may require 't' (--force):",
      "  mystery",
      "Note: 2 malformed file record(s) in the registry entry are dropped with it.",
      "The registry entry of 't' will be removed.",
    ]);
  });

  it("formatRemovalOutcome prints no section header for an empty list", () => {
    assert.deepEqual(formatRemovalOutcome(EMPTY_OUTCOME), [
      "Removed template 't'.",
    ]);
  });

  it("formatRemovalOutcome lists deletions, pruned folders, kept files, warnings and the checklist", () => {
    const lines = formatRemovalOutcome({
      ...EMPTY_OUTCOME,
      deleted: ["d/one.txt"],
      prunedDirs: ["d/sub"],
      keptChanged: ["k-changed.txt"],
      skippedAtDelete: [{ path: "late.txt", reason: "changed" }],
      conflictCopies: ["d/one.hexagen-update.txt"],
      brokenDependents: ["child"],
      derivedAnswerWarnings: ["derived"],
      checklist: ["run the tests"],
    });
    assert.deepEqual(lines, [
      "Removed template 't'.",
      "Deleted 1 file(s):",
      "  d/one.txt",
      "Removed 1 empty folder(s):",
      "  d/sub",
      "Kept: changed since install:",
      "  k-changed.txt",
      "Kept at the last moment (changed while the command ran):",
      "  late.txt (changed)",
      "Conflict copies beside these files (listed, NOT deleted):",
      "  d/one.hexagen-update.txt",
      "WARNING: these installed templates require 't' and will be broken (--force):",
      "  child",
      "Templates whose derived answers came from 't' (re-run their add to refresh):",
      "  derived",
      "Manual steps to undo (package.json is never edited):",
      "  run the tests",
    ]);
  });

  it("--dry-run prints the plan, changes nothing, and calls execute exactly once with dryRun: true", async () => {
    const world = makeWorld([manifest("t", ["a.txt", "b.txt", "c.txt"])], {
      "t/files/a.txt": "a-content\n",
      "t/files/b.txt": "b-content\n",
      "t/files/c.txt": "c-original\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    await fsp.writeFile(
      path.join(world.projectRoot, "c.txt"),
      "the user rewrote this\n",
      "utf-8",
    );
    const treeBefore = await snapshotTree(world.projectRoot);
    const registryBefore = await readRegistryFile(world.projectRoot);
    const useCase = world.remove();
    const spy = vi.spyOn(useCase, "execute");

    const code = await runRemoveTemplate(
      "t",
      { dryRun: true },
      world.deps({ useCase }),
    );

    assert.equal(code, 0);
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][0].dryRun, true);
    const logs = world.logs.join("\n");
    assert.equal(
      logs.includes("Will delete (unchanged since install):\n  a.txt\n  b.txt"),
      true,
    );
    assert.equal(logs.includes("Kept: changed since install:\n  c.txt"), true);
    assert.equal(logs.includes("Dry run: nothing was changed."), true);
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
    expect(world.confirm).not.toHaveBeenCalled();
  });

  it("--dry-run --force still deletes nothing and still makes exactly one call", async () => {
    const world = makeWorld([manifest("t", ["a.txt"])], {
      "t/files/a.txt": "a-original\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    await fsp.writeFile(
      path.join(world.projectRoot, "a.txt"),
      "the user rewrote this\n",
      "utf-8",
    );
    const treeBefore = await snapshotTree(world.projectRoot);
    const useCase = world.remove();
    const spy = vi.spyOn(useCase, "execute");

    const code = await runRemoveTemplate(
      "t",
      { dryRun: true, force: true },
      world.deps({ useCase }),
    );

    assert.equal(code, 0);
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][0].dryRun, true);
    assert.equal(
      world.logs
        .join("\n")
        .includes(
          "Will delete although CHANGED since install (--force):\n  a.txt",
        ),
      true,
    );
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
  });

  it("--dry-run --keep-files deletes nothing, keeps the entry, and makes exactly one call with keepFiles: true", async () => {
    const world = makeWorld([manifest("t", ["a.txt"])], {
      "t/files/a.txt": "a-original\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const treeBefore = await snapshotTree(world.projectRoot);
    const useCase = world.remove();
    const spy = vi.spyOn(useCase, "execute");

    const code = await runRemoveTemplate(
      "t",
      { dryRun: true, keepFiles: true },
      world.deps({ useCase }),
    );

    assert.equal(code, 0);
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(spy.mock.calls[0][0].dryRun, true);
    assert.equal(spy.mock.calls[0][0].keepFiles, true);
    assert.equal(
      world.logs.join("\n").includes("Kept: --keep-files:\n  a.txt"),
      true,
    );
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
  });

  it("interactive with a yes confirmation removes the files, prunes the emptied folder, keeps the changed file listed, and leaves the other template's entry untouched", async () => {
    const world = makeWorld(
      [
        manifest("t", ["dir/one.txt", "dir/sub/two.txt", "dir/kept.txt"]),
        manifest("other", ["other.txt"]),
      ],
      {
        "t/files/dir/one.txt": "one-content\n",
        "t/files/dir/sub/two.txt": "two-content\n",
        "t/files/dir/kept.txt": "kept-original\n",
        "other/files/other.txt": "other-content\n",
      },
    );
    await world.add().execute({
      templateIds: ["t", "other"],
      projectRoot: world.projectRoot,
    });
    const before = JSON.parse(await readRegistryFile(world.projectRoot));
    const otherEntryBefore = JSON.stringify(before.templates.other);
    await fsp.writeFile(
      path.join(world.projectRoot, "dir/kept.txt"),
      "the user rewrote this\n",
      "utf-8",
    );

    const code = await runRemoveTemplate("t", {}, world.deps());

    assert.equal(code, 0);
    expect(world.confirm).toHaveBeenCalledTimes(1);
    expect(world.confirm).toHaveBeenCalledWith("Remove template 't'?");
    await assert.rejects(
      fsp.access(path.join(world.projectRoot, "dir/one.txt")),
    );
    await assert.rejects(
      fsp.access(path.join(world.projectRoot, "dir/sub/two.txt")),
    );
    await assert.rejects(fsp.access(path.join(world.projectRoot, "dir/sub")));
    assert.equal(
      await fsp.readFile(path.join(world.projectRoot, "dir/kept.txt"), "utf-8"),
      "the user rewrote this\n",
    );
    const logs = world.logs.join("\n");
    assert.equal(
      logs.includes("Kept: changed since install:\n  dir/kept.txt"),
      true,
    );
    assert.equal(logs.includes("Removed template 't'."), true);
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
    assert.equal(JSON.stringify(after.templates.other), otherEntryBefore);
  });

  it("a declined confirmation exits 0, changes nothing, and makes exactly one call", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const treeBefore = await snapshotTree(world.projectRoot);
    const registryBefore = await readRegistryFile(world.projectRoot);
    const useCase = world.remove();
    const spy = vi.spyOn(useCase, "execute");
    world.confirm.mockResolvedValue(false);

    const code = await runRemoveTemplate("t", {}, world.deps({ useCase }));

    assert.equal(code, 0);
    assert.equal(spy.mock.calls.length, 1);
    assert.equal(world.logs.includes("Nothing was changed."), true);
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
  });

  it("a non-interactive run without --force refuses on stdin, changes nothing, and never asks", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const treeBefore = await snapshotTree(world.projectRoot);
    const registryBefore = await readRegistryFile(world.projectRoot);

    const code = await runRemoveTemplate(
      "t",
      {},
      world.deps({ isInteractive: false }),
    );

    assert.equal(code, 1);
    assert.equal(
      world.errors.includes(
        "Refusing to remove without confirmation: stdin is not a terminal. Pass --force to skip the prompt, or --dry-run to see the plan.",
      ),
      true,
    );
    expect(world.confirm).not.toHaveBeenCalled();
    assert.deepEqual(await snapshotTree(world.projectRoot), treeBefore);
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
  });

  it("--force on a non-interactive run deletes the changed file too and never asks", async () => {
    const world = makeWorld([manifest("t", ["a.txt", "b.txt"])], {
      "t/files/a.txt": "a-original\n",
      "t/files/b.txt": "b-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    await fsp.writeFile(
      path.join(world.projectRoot, "a.txt"),
      "the user rewrote this\n",
      "utf-8",
    );

    const code = await runRemoveTemplate(
      "t",
      { force: true },
      world.deps({ isInteractive: false }),
    );

    assert.equal(code, 0);
    expect(world.confirm).not.toHaveBeenCalled();
    await assert.rejects(fsp.access(path.join(world.projectRoot, "a.txt")));
    await assert.rejects(fsp.access(path.join(world.projectRoot, "b.txt")));
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });

  it("--keep-files --force removes the entry and leaves every file", async () => {
    const world = makeWorld([manifest("t", ["k/deep/k.txt", "plain.txt"])], {
      "t/files/k/deep/k.txt": "k-content\n",
      "t/files/plain.txt": "plain-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const treeBefore = await snapshotTree(world.projectRoot);

    const code = await runRemoveTemplate(
      "t",
      { keepFiles: true, force: true },
      world.deps({ isInteractive: false }),
    );

    assert.equal(code, 0);
    const treeAfter = await snapshotTree(world.projectRoot);
    delete treeBefore[TEMPLATE_CONFIG_FILE];
    delete treeAfter[TEMPLATE_CONFIG_FILE];
    assert.deepEqual(treeAfter, treeBefore);
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });

  it("refuses while a dependent is installed, names it, and --force removes with a WARNING naming it", async () => {
    const world = makeWorld(
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

    const refused = await runRemoveTemplate("base", {}, world.deps());

    assert.equal(refused, 1);
    assert.equal(
      world.errors.includes(
        "Refused: these installed templates require 'base': child. Remove them first, or pass --force.",
      ),
      true,
    );
    assert.equal(
      await fsp.readFile(path.join(world.projectRoot, "base.txt"), "utf-8"),
      "base-content\n",
    );
    assert.equal(await readRegistryFile(world.projectRoot), registryBefore);

    world.logs.length = 0;
    world.errors.length = 0;
    const forced = await runRemoveTemplate(
      "base",
      { force: true },
      world.deps({ isInteractive: false }),
    );
    assert.equal(forced, 0);
    assert.equal(
      world.logs
        .join("\n")
        .includes(
          "WARNING: these installed templates require 'base' and will be broken (--force):\n  child",
        ),
      true,
    );
    await assert.rejects(fsp.access(path.join(world.projectRoot, "base.txt")));
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "base"), false);
    assert.equal(Object.hasOwn(after.templates, "child"), true);
  });

  it("a file another installed template also records is kept and listed, also with --force", async () => {
    const world = makeWorld(
      [
        manifest("t", ["shared.txt", "t.txt"]),
        manifest("u", ["shared.txt", "u.txt"]),
      ],
      {
        "t/files/shared.txt": "shared-content\n",
        "t/files/t.txt": "t-only\n",
        "u/files/shared.txt": "shared-content\n",
        "u/files/u.txt": "u-only\n",
      },
    );
    await world.add().execute({
      templateIds: ["t", "u"],
      projectRoot: world.projectRoot,
    });

    const code = await runRemoveTemplate(
      "t",
      { force: true },
      world.deps({ isInteractive: false }),
    );

    assert.equal(code, 0);
    assert.equal(
      await fsp.readFile(path.join(world.projectRoot, "shared.txt"), "utf-8"),
      "shared-content\n",
    );
    await assert.rejects(fsp.access(path.join(world.projectRoot, "t.txt")));
    assert.equal(
      world.logs
        .join("\n")
        .includes(
          "Kept: also recorded by another installed template:\n  shared.txt",
        ),
      true,
    );
  });

  it("refuses an unsafe recorded path without and with --force, never suggesting --force; --keep-files drops the entry", async () => {
    const world = makeWorld([manifest("t", ["ok.txt"])], {
      "t/files/ok.txt": "ok-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    const SENTINEL = "sentinel-content\n";
    // outside.txt lives INSIDE the mkdtemp directory, one level above the
    // nested project root: the test never leaves its mkdtemp.
    await fsp.writeFile(path.join(world.dir, "outside.txt"), SENTINEL, "utf-8");
    const config = await world.configStore.load(world.projectRoot);
    config.templates.t.generatedFiles.push({
      path: "../outside.txt",
      contentHash: "whatever",
    });
    await world.configStore.save(world.projectRoot, config);
    const registryBefore = await readRegistryFile(world.projectRoot);

    for (const options of [{}, { force: true }]) {
      world.errors.length = 0;
      const code = await runRemoveTemplate(
        "t",
        options,
        world.deps({ isInteractive: false }),
      );
      assert.equal(code, 1);
      assert.equal(world.errors.length, 1);
      const line = world.errors[0];
      assert.equal(
        line.startsWith("Refused: the registry records paths"),
        true,
      );
      assert.equal(line.includes("../outside.txt"), true);
      assert.equal(line.includes("--force"), false);
      assert.equal(line.includes("--keep-files"), true);
      assert.equal(
        await fsp.readFile(path.join(world.dir, "outside.txt"), "utf-8"),
        SENTINEL,
      );
      assert.equal(await readRegistryFile(world.projectRoot), registryBefore);
    }

    const kept = await runRemoveTemplate(
      "t",
      { keepFiles: true, force: true },
      world.deps({ isInteractive: false }),
    );
    assert.equal(kept, 0);
    assert.equal(
      await fsp.readFile(path.join(world.dir, "outside.txt"), "utf-8"),
      SENTINEL,
    );
    assert.equal(
      await fsp.readFile(path.join(world.projectRoot, "ok.txt"), "utf-8"),
      "ok-content\n",
    );
    const after = JSON.parse(await readRegistryFile(world.projectRoot));
    assert.equal(Object.hasOwn(after.templates, "t"), false);
  });

  it("lists a .hexagen-update conflict copy and leaves it on disk", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    await fsp.writeFile(
      path.join(world.projectRoot, "one.hexagen-update.txt"),
      "conflict\n",
      "utf-8",
    );

    const code = await runRemoveTemplate("t", {}, world.deps());

    assert.equal(code, 0);
    assert.equal(
      world.logs
        .join("\n")
        .includes(
          "Conflict copies beside these files (listed, NOT deleted):\n  one.hexagen-update.txt",
        ),
      true,
    );
    assert.equal(
      await fsp.readFile(
        path.join(world.projectRoot, "one.hexagen-update.txt"),
        "utf-8",
      ),
      "conflict\n",
    );
    await assert.rejects(fsp.access(path.join(world.projectRoot, "one.txt")));
  });

  it("a throwing use case exits 1 with 'Remove failed'", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });
    // A schema fault from loadState propagates out of the use case.
    await fsp.writeFile(
      path.join(world.projectRoot, TEMPLATE_CONFIG_FILE),
      JSON.stringify({ schemaVersion: "1" }),
      "utf-8",
    );

    const code = await runRemoveTemplate("t", {}, world.deps());

    assert.equal(code, 1);
    assert.equal(
      world.errors.some((l) => l.startsWith("Remove failed: ")),
      true,
    );
  });

  it("prints one monorepo note before the plan when other packages are known", async () => {
    const world = makeWorld([manifest("t", ["one.txt"])], {
      "t/files/one.txt": "one-content\n",
    });
    await world.add().execute({
      templateIds: ["t"],
      projectRoot: world.projectRoot,
    });

    const code = await runRemoveTemplate(
      "t",
      { dryRun: true },
      world.deps({ otherPackages: ["packages/a", "packages/b"] }),
    );

    assert.equal(code, 0);
    const note =
      "Note: this acts on the registry at " +
      `${world.projectRoot} only; other packages (2) are not looked at.`;
    assert.equal(world.logs[0], `Project root: ${world.projectRoot}`);
    const noteIndex = world.logs.indexOf(note);
    assert.equal(noteIndex >= 0, true);
    assert.equal(world.logs.filter((l) => l === note).length, 1);
    const planIndex = world.logs.indexOf(
      "Will delete (unchanged since install):",
    );
    assert.equal(noteIndex < planIndex, true);
  });
});
