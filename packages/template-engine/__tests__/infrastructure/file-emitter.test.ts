import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { emptyConfig, conflictFilePath } from "../../src/domain/index.js";
import type {
  TemplateManifest,
  ManifestOutput,
} from "../../src/domain/index.js";

function testManifest(
  outputs: ManifestOutput[] = ["output.txt"],
): TemplateManifest {
  return {
    id: "__test__",
    name: "Test",
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

describe("FileSystemFileEmitter", () => {
  let tmpDir: string;
  let templatesDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-emitter-test-"));
    templatesDir = path.join(tmpDir, "templates");
    await fs.mkdir(path.join(templatesDir, "__test__", "files"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(templatesDir, "__test__", "files", "output.txt"),
      "Hello {name}!",
      "utf-8",
    );
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function freshProject(): Promise<string> {
    const dir = path.join(
      tmpDir,
      `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  it("writes a new file when destination does not exist", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const result = await emitter.emit(
      testManifest(),
      { name: "World" },
      projectRoot,
      emptyConfig(),
    );

    assert.equal(result.warnings.length, 0);
    assert.equal(result.generatedFiles.length, 1);
    assert.equal(result.generatedFiles[0].path, "output.txt");

    const content = await fs.readFile(
      path.join(projectRoot, "output.txt"),
      "utf-8",
    );
    assert.equal(content, "Hello World!");
  });

  it("overwrites silently when file matches stored hash (idempotent)", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const config = emptyConfig();

    const first = await emitter.emit(
      testManifest(),
      { name: "World" },
      projectRoot,
      config,
    );
    config.templates["__test__"] = {
      installedAt: new Date().toISOString(),
      version: "1.0.0",
      answers: { name: "World" },
      generatedFiles: first.generatedFiles,
    };

    const second = await emitter.emit(
      testManifest(),
      { name: "World" },
      projectRoot,
      config,
    );
    assert.equal(second.warnings.length, 0);
    assert.equal(second.generatedFiles.length, 1);
  });

  it("emits a conflict file when user has modified the generated file", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const config = emptyConfig();

    const first = await emitter.emit(
      testManifest(),
      { name: "World" },
      projectRoot,
      config,
    );
    config.templates["__test__"] = {
      installedAt: new Date().toISOString(),
      version: "1.0.0",
      answers: { name: "World" },
      generatedFiles: first.generatedFiles,
    };

    // User modifies the file
    await fs.writeFile(
      path.join(projectRoot, "output.txt"),
      "User modified content",
      "utf-8",
    );

    const second = await emitter.emit(
      testManifest(),
      { name: "Updated" },
      projectRoot,
      config,
    );
    assert.equal(second.warnings.length, 1);
    assert.match(second.warnings[0], /Conflict/);

    await assert.doesNotReject(
      fs.access(conflictFilePath(path.join(projectRoot, "output.txt"))),
    );

    const content = await fs.readFile(
      path.join(projectRoot, "output.txt"),
      "utf-8",
    );
    assert.equal(content, "User modified content");
  });

  it("interpolates {variable} placeholders with answer values", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    await emitter.emit(
      testManifest(),
      { name: "Hexagen" },
      projectRoot,
      emptyConfig(),
    );
    const content = await fs.readFile(
      path.join(projectRoot, "output.txt"),
      "utf-8",
    );
    assert.equal(content, "Hello Hexagen!");
  });

  it("skips output files that have no template content (planned but not yet implemented)", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const manifest = testManifest(["output.txt", "missing-template.ts"]);
    const result = await emitter.emit(
      manifest,
      { name: "Test" },
      projectRoot,
      emptyConfig(),
    );
    // output.txt has a template; missing-template.ts does not → only 1 generated file
    assert.equal(result.generatedFiles.length, 1);
    assert.equal(result.generatedFiles[0].path, "output.txt");
  });

  it("skips a gated output when its condition is not met", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const manifest = testManifest([
      { path: "output.txt", when: { answer: "enabled", equals: true } },
    ]);
    const result = await emitter.emit(
      manifest,
      { name: "World", enabled: false },
      projectRoot,
      emptyConfig(),
    );
    assert.equal(result.generatedFiles.length, 0);
    await assert.rejects(fs.access(path.join(projectRoot, "output.txt")));
  });

  it("preserves the executable bit from the template source file", async () => {
    const src = path.join(templatesDir, "__test__", "files", "output.txt");
    const originalMode = (await fs.stat(src)).mode & 0o777;
    await fs.chmod(src, 0o755);
    try {
      const projectRoot = await freshProject();
      const emitter = new FileSystemFileEmitter(templatesDir);
      await emitter.emit(
        testManifest(),
        { name: "World" },
        projectRoot,
        emptyConfig(),
      );
      const st = await fs.stat(path.join(projectRoot, "output.txt"));
      assert.equal(
        (st.mode & 0o111) !== 0,
        true,
        "emitted file should be executable",
      );
    } finally {
      await fs.chmod(src, originalMode);
    }
  });

  it("emits a gated output when its condition is met", async () => {
    const projectRoot = await freshProject();
    const emitter = new FileSystemFileEmitter(templatesDir);
    const manifest = testManifest([
      { path: "output.txt", when: { answer: "enabled", equals: true } },
    ]);
    const result = await emitter.emit(
      manifest,
      { name: "World", enabled: true },
      projectRoot,
      emptyConfig(),
    );
    assert.equal(result.generatedFiles.length, 1);
    assert.equal(result.generatedFiles[0].path, "output.txt");
    const content = await fs.readFile(
      path.join(projectRoot, "output.txt"),
      "utf-8",
    );
    assert.equal(content, "Hello World!");
  });

  it("removes the temp file when the write fails", async () => {
    const projectRoot = await freshProject();
    // Destination is an existing directory, so the final rename fails.
    await fs.mkdir(path.join(projectRoot, "blocked"), { recursive: true });
    await fs.writeFile(
      path.join(templatesDir, "__test__", "files", "blocked"),
      "x",
      "utf-8",
    );
    const emitter = new FileSystemFileEmitter(templatesDir);

    await assert.rejects(
      emitter.emit(
        testManifest(["blocked"]),
        { name: "X" },
        projectRoot,
        emptyConfig(),
      ),
    );

    const leftovers = (await fs.readdir(projectRoot)).filter((f) =>
      f.includes(".tmp."),
    );
    assert.deepEqual(leftovers, [], "no temp file should remain after failure");
  });
});
