import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemProjectRemovalFiles } from "../../src/infrastructure/project-removal-files.adapter.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { RemovalDeleteError } from "../../src/application/index.js";
import { emptyConfig } from "../../src/domain/index.js";
import type { TemplateManifest } from "../../src/domain/index.js";

/**
 * The filesystem side of `hexagen remove` (proposal 2026-10-10, lane Q3b).
 * This code deletes files in a user's project: every test works only inside
 * its own `fs.mkdtemp(os.tmpdir() + "/hexagen-remove-")` directory, removed
 * in `afterEach`, and asserts what is STILL ON DISK, not only what the
 * adapter reports.
 */

let tmp: string;
let project: string;
let removals: FileSystemProjectRemovalFiles;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-remove-"));
  project = path.join(tmp, "project");
  await fs.mkdir(project);
  removals = new FileSystemProjectRemovalFiles();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<string> {
  const abs = path.join(project, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

async function makeDir(rel: string): Promise<string> {
  const abs = path.join(project, rel);
  await fs.mkdir(abs, { recursive: true });
  return abs;
}

/** A file outside the project, in the temp directory beside the project folder. */
async function writeOutside(name: string, content: string): Promise<string> {
  const abs = path.join(tmp, name);
  await fs.writeFile(abs, content, "utf-8");
  return abs;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

const SMALL_MANIFEST: TemplateManifest = {
  id: "small",
  name: "Small",
  description: "",
  version: "1.0.0",
  requires: [],
  conflicts: [],
  questions: [],
  envVars: [],
  outputs: ["small.txt"],
  checklist: [],
};

describe("FileSystemProjectRemovalFiles.inspect", () => {
  it("gives a plain file the same hash the real FileSystemFileEmitter records", async () => {
    const templatesDir = path.join(tmp, "templates");
    await fs.mkdir(path.join(templatesDir, "small", "files"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(templatesDir, "small", "files", "small.txt"),
      "hello",
      "utf-8",
    );
    const emitted = await new FileSystemFileEmitter(templatesDir).emit(
      SMALL_MANIFEST,
      {},
      project,
      emptyConfig(),
    );
    assert.equal(emitted.generatedFiles.length, 1);
    const recorded = emitted.generatedFiles[0];

    const states = await removals.inspect(project, ["small.txt"]);
    assert.deepEqual(states.get("small.txt"), {
      kind: "file",
      contentHash: recorded.contentHash,
    });
  });

  it("reports an absent path as absent", async () => {
    const states = await removals.inspect(project, ["nope.txt"]);
    assert.deepEqual(states.get("nope.txt"), { kind: "absent" });
  });

  it("reports a directory as other", async () => {
    await makeDir("somedir");
    const states = await removals.inspect(project, ["somedir"]);
    assert.equal(states.get("somedir")?.kind, "other");
  });

  it.skipIf(process.platform === "win32")(
    "reports a symlink to a file as other",
    async () => {
      await writeFile("target.txt", "target");
      await fs.symlink(
        path.join(project, "target.txt"),
        path.join(project, "link.txt"),
      );
      const states = await removals.inspect(project, ["link.txt"]);
      assert.equal(states.get("link.txt")?.kind, "other");
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a file reached through a symlinked directory as other, link inside the root",
    async () => {
      await writeFile("realdir/inner.txt", "inside");
      await fs.symlink(
        path.join(project, "realdir"),
        path.join(project, "alias"),
      );
      const states = await removals.inspect(project, ["alias/inner.txt"]);
      assert.equal(states.get("alias/inner.txt")?.kind, "other");
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a file reached through a symlinked directory as other, link outside the root",
    async () => {
      await fs.mkdir(path.join(tmp, "outsidedir"));
      await fs.writeFile(
        path.join(tmp, "outsidedir", "inner.txt"),
        "outside",
        "utf-8",
      );
      await fs.symlink(
        path.join(tmp, "outsidedir"),
        path.join(project, "alias-out"),
      );
      const states = await removals.inspect(project, ["alias-out/inner.txt"]);
      assert.equal(states.get("alias-out/inner.txt")?.kind, "other");
    },
  );

  it('reports "../x", "/abs" and "a/../b" as other "unsafe path"', async () => {
    const states = await removals.inspect(project, ["../x", "/abs", "a/../b"]);
    assert.deepEqual(states.get("../x"), {
      kind: "other",
      detail: "unsafe path",
    });
    assert.deepEqual(states.get("/abs"), {
      kind: "other",
      detail: "unsafe path",
    });
    assert.deepEqual(states.get("a/../b"), {
      kind: "other",
      detail: "unsafe path",
    });
  });

  it('reports "sub/../.git/config" as other "unsafe path"', async () => {
    await writeFile(".git/config", "[core]");
    const states = await removals.inspect(project, ["sub/../.git/config"]);
    assert.deepEqual(states.get("sub/../.git/config"), {
      kind: "other",
      detail: "unsafe path",
    });
  });

  it("answers a case-variant folder consistently, never with a throw", async () => {
    await writeFile("Docs/x.txt", "doc");
    const states = await removals.inspect(project, ["docs/x.txt"]);
    const state = states.get("docs/x.txt");
    const sameCase = await removals.inspect(project, ["Docs/x.txt"]);
    // Either the variant spelling does not exist (case-sensitive) or it is
    // the very same file (case-insensitive). Anything else — a throw, a
    // directory, a different hash — is a bug.
    if (state?.kind === "absent") {
      assert.equal(sameCase.get("Docs/x.txt")?.kind, "file");
    } else {
      assert.deepEqual(state, sameCase.get("Docs/x.txt"));
    }
  });

  it.skipIf(process.platform === "win32")(
    "works when the project root is given as a symlink to the real folder",
    async () => {
      await writeFile("x.txt", "content");
      const link = path.join(tmp, "root-link");
      await fs.symlink(project, link);
      const viaLink = await removals.inspect(link, ["x.txt"]);
      const direct = await removals.inspect(project, ["x.txt"]);
      assert.deepEqual(viaLink.get("x.txt"), direct.get("x.txt"));
      assert.equal(viaLink.get("x.txt")?.kind, "file");
    },
  );
});

describe("FileSystemProjectRemovalFiles.deleteFiles", () => {
  it("deletes a file whose content matches the expected hash", async () => {
    const abs = await writeFile("a.txt", "one");
    const states = await removals.inspect(project, ["a.txt"]);
    const hash = states.get("a.txt");
    assert.equal(hash?.kind, "file");

    const outcome = await removals.deleteFiles(project, [
      { path: "a.txt", expectedHashes: [hash!.contentHash] },
    ]);
    assert.deepEqual(outcome, { deleted: ["a.txt"], skipped: [] });
    assert.equal(await exists(abs), false);
  });

  it("keeps a changed file and skips it as changed", async () => {
    const abs = await writeFile("b.txt", "changed content");
    const outcome = await removals.deleteFiles(project, [
      { path: "b.txt", expectedHashes: ["0".repeat(64)] },
    ]);
    assert.deepEqual(outcome, {
      deleted: [],
      skipped: [{ path: "b.txt", reason: "changed" }],
    });
    assert.equal(await fs.readFile(abs, "utf-8"), "changed content");
  });

  it("THE RACE: a file overwritten between inspect and deleteFiles is not deleted", async () => {
    const abs = await writeFile("race.txt", "before");
    const states = await removals.inspect(project, ["race.txt"]);
    const staleHash = states.get("race.txt");
    assert.equal(staleHash?.kind, "file");
    await fs.writeFile(abs, "after", "utf-8");

    const outcome = await removals.deleteFiles(project, [
      { path: "race.txt", expectedHashes: [staleHash!.contentHash] },
    ]);
    assert.deepEqual(outcome, {
      deleted: [],
      skipped: [{ path: "race.txt", reason: "changed" }],
    });
    assert.equal(await fs.readFile(abs, "utf-8"), "after");
  });

  it("deletes a changed file when expectedHashes is null (--force)", async () => {
    const abs = await writeFile("forced.txt", "user edits");
    const outcome = await removals.deleteFiles(project, [
      { path: "forced.txt", expectedHashes: null },
    ]);
    assert.deepEqual(outcome, { deleted: ["forced.txt"], skipped: [] });
    assert.equal(await exists(abs), false);
  });

  it("never touches a sentinel outside the root, however it is addressed", async () => {
    const sentinel = await writeOutside("sentinel.txt", "do not delete");
    const requests = [
      { path: "../sentinel.txt", expectedHashes: null },
      { path: sentinel, expectedHashes: null },
      { path: "sub/../../sentinel.txt", expectedHashes: null },
    ];
    const outcome = await removals.deleteFiles(project, requests);
    assert.deepEqual(outcome, {
      deleted: [],
      skipped: requests.map((request) => ({
        path: request.path,
        reason: "unsafe-path",
      })),
    });
    assert.equal(await fs.readFile(sentinel, "utf-8"), "do not delete");
  });

  it.skipIf(process.platform === "win32")(
    "does not delete through a symlink and keeps the target",
    async () => {
      const sentinel = await writeOutside("sentinel.txt", "do not delete");
      await fs.symlink(sentinel, path.join(project, "link.txt"));
      await fs.mkdir(path.join(tmp, "outsidedir"));
      await fs.writeFile(
        path.join(tmp, "outsidedir", "inner.txt"),
        "outside",
        "utf-8",
      );
      await fs.symlink(
        path.join(tmp, "outsidedir"),
        path.join(project, "alias"),
      );

      const outcome = await removals.deleteFiles(project, [
        { path: "link.txt", expectedHashes: null },
        { path: "alias/inner.txt", expectedHashes: null },
      ]);
      assert.deepEqual(outcome, {
        deleted: [],
        skipped: [
          { path: "link.txt", reason: "not-a-plain-file" },
          { path: "alias/inner.txt", reason: "not-a-plain-file" },
        ],
      });
      assert.equal(
        (await fs.lstat(path.join(project, "link.txt"))).isSymbolicLink(),
        true,
      );
      assert.equal(await fs.readFile(sentinel, "utf-8"), "do not delete");
      assert.equal(
        await fs.readFile(path.join(tmp, "outsidedir", "inner.txt"), "utf-8"),
        "outside",
      );
    },
  );

  it("skips the registry file and .git/config as unsafe even with --force", async () => {
    const registry = await writeFile(".hexagen-template-config.json", "{}");
    const gitConfig = await writeFile(".git/config", "[core]");
    const outcome = await removals.deleteFiles(project, [
      { path: ".hexagen-template-config.json", expectedHashes: null },
      { path: ".git/config", expectedHashes: null },
    ]);
    assert.deepEqual(outcome, {
      deleted: [],
      skipped: [
        {
          path: ".hexagen-template-config.json",
          reason: "unsafe-path",
        },
        { path: ".git/config", reason: "unsafe-path" },
      ],
    });
    assert.equal(await fs.readFile(registry, "utf-8"), "{}");
    assert.equal(await fs.readFile(gitConfig, "utf-8"), "[core]");
  });

  it("skips a directory at the path and keeps it with its content", async () => {
    await makeDir("dir");
    await writeFile("dir/keep.txt", "kept");
    const outcome = await removals.deleteFiles(project, [
      { path: "dir", expectedHashes: null },
    ]);
    assert.deepEqual(outcome, {
      deleted: [],
      skipped: [{ path: "dir", reason: "not-a-plain-file" }],
    });
    assert.equal(
      await fs.readFile(path.join(project, "dir", "keep.txt"), "utf-8"),
      "kept",
    );
  });
});

describe("FileSystemProjectRemovalFiles: review pins", () => {
  it.skipIf(process.platform === "win32")(
    "deletes through a project root that is itself a symbolic link, and nothing beside it",
    async () => {
      await writeFile("src/gen.ts", "generated");
      await writeFile("src/keep.ts", "kept");
      const link = path.join(tmp, "project-link");
      await fs.symlink(project, link);
      const states = await removals.inspect(link, ["src/gen.ts"]);
      const state = states.get("src/gen.ts");
      assert.ok(state !== undefined && state.kind === "file");
      const outcome = await removals.deleteFiles(link, [
        { path: "src/gen.ts", expectedHashes: [state.contentHash] },
      ]);
      assert.deepEqual(outcome.deleted, ["src/gen.ts"]);
      assert.equal(await exists(path.join(project, "src/gen.ts")), false);
      assert.equal(await exists(path.join(project, "src/keep.ts")), true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not prune empty folders reached through a symbolic link above them",
    async () => {
      // outside/b/c is an empty tree OUTSIDE the project; project/a -> outside.
      const outside = path.join(tmp, "outside");
      await fs.mkdir(path.join(outside, "b", "c"), { recursive: true });
      await fs.symlink(outside, path.join(project, "a"));
      const removed = await removals.pruneEmptyDirs(project, ["a/b/c/x.txt"]);
      assert.deepEqual(removed, []);
      assert.equal(await exists(path.join(outside, "b", "c")), true);
      assert.equal(await exists(path.join(outside, "b")), true);
    },
  );

  it.skipIf(
    process.platform === "win32" ||
      (typeof process.getuid === "function" && process.getuid() === 0),
  )(
    "a failed unlink throws an error that carries what was already deleted",
    async () => {
      await writeFile("ok/first.ts", "one");
      const locked = await writeFile("locked/second.ts", "two");
      await fs.chmod(path.dirname(locked), 0o555);
      try {
        await assert.rejects(
          removals.deleteFiles(project, [
            { path: "ok/first.ts", expectedHashes: null },
            { path: "locked/second.ts", expectedHashes: null },
          ]),
          (err: unknown) => {
            assert.ok(err instanceof RemovalDeleteError);
            assert.equal(err.path, "locked/second.ts");
            assert.deepEqual(err.partial.deleted, ["ok/first.ts"]);
            return true;
          },
        );
        assert.equal(await exists(path.join(project, "ok/first.ts")), false);
        assert.equal(await exists(locked), true);
      } finally {
        await fs.chmod(path.dirname(locked), 0o755);
      }
    },
  );

  it.skipIf(
    process.platform === "win32" ||
      (typeof process.getuid === "function" && process.getuid() === 0),
  )(
    "keeps a file it cannot read and says unreadable, not changed",
    async () => {
      const secret = await writeFile("secret.ts", "content");
      await fs.chmod(secret, 0o000);
      try {
        const outcome = await removals.deleteFiles(project, [
          { path: "secret.ts", expectedHashes: ["anything"] },
        ]);
        assert.deepEqual(outcome.deleted, []);
        assert.deepEqual(outcome.skipped, [
          { path: "secret.ts", reason: "unreadable" },
        ]);
        assert.equal(await exists(secret), true);
      } finally {
        await fs.chmod(secret, 0o644);
      }
    },
  );
});

describe("FileSystemProjectRemovalFiles.pruneEmptyDirs", () => {
  it("removes the folders a deletion left empty, upward", async () => {
    await writeFile("a/b/c/x.txt", "x");
    await fs.unlink(path.join(project, "a", "b", "c", "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, ["a/b/c/x.txt"]);
    assert.deepEqual(removed, ["a", "a/b", "a/b/c"]);
    assert.equal(await exists(path.join(project, "a")), false);
    assert.equal(await exists(project), true);
  });

  it("stops at a folder that still has a sibling file", async () => {
    await writeFile("a/b/c/x.txt", "x");
    await writeFile("a/b/sibling.txt", "s");
    await fs.unlink(path.join(project, "a", "b", "c", "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, ["a/b/c/x.txt"]);
    assert.deepEqual(removed, ["a/b/c"]);
    assert.equal(
      await fs.readFile(path.join(project, "a", "b", "sibling.txt"), "utf-8"),
      "s",
    );
  });

  it("leaves an empty folder that was not on the path of a deletion", async () => {
    await writeFile("n/x.txt", "x");
    await makeDir("lonely");
    await fs.unlink(path.join(project, "n", "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, ["n/x.txt"]);
    assert.deepEqual(removed, ["n"]);
    assert.equal(await exists(path.join(project, "lonely")), true);
  });

  it("never removes the project root, even when the deletion empties it", async () => {
    await writeFile("x.txt", "x");
    await fs.unlink(path.join(project, "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, ["x.txt"]);
    assert.deepEqual(removed, []);
    assert.equal(await exists(project), true);
  });

  it("leaves the folder of a kept file untouched", async () => {
    await writeFile("m/x.txt", "x");
    await writeFile("m/y.txt", "y");
    await fs.unlink(path.join(project, "m", "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, ["m/x.txt"]);
    assert.deepEqual(removed, []);
    assert.equal(
      await fs.readFile(path.join(project, "m", "y.txt"), "utf-8"),
      "y",
    );
  });

  it("ignores an unsafe deleted path", async () => {
    await writeFile("a/b/x.txt", "x");
    await fs.unlink(path.join(project, "a", "b", "x.txt"));
    const removed = await removals.pruneEmptyDirs(project, [
      "../a/b/x.txt",
      "a/b/x.txt",
    ]);
    assert.deepEqual(removed, ["a", "a/b"]);
  });
});

describe("FileSystemProjectRemovalFiles.existingConflictCopies", () => {
  it("lists the present .hexagen-update copy of a .ts file", async () => {
    await writeFile("rate-limit.ts", "code");
    await writeFile("rate-limit.hexagen-update.ts", "new code");
    const copies = await removals.existingConflictCopies(project, [
      "rate-limit.ts",
    ]);
    assert.deepEqual(copies, ["rate-limit.hexagen-update.ts"]);
  });

  it("lists a conflict copy without an extension", async () => {
    await writeFile("Dockerfile", "FROM node");
    await writeFile("Dockerfile.hexagen-update", "FROM node:22");
    const copies = await removals.existingConflictCopies(project, [
      "Dockerfile",
    ]);
    assert.deepEqual(copies, ["Dockerfile.hexagen-update"]);
  });

  it("lists nothing when no conflict copy exists", async () => {
    await writeFile("rate-limit.ts", "code");
    await writeFile("plain.txt", "plain");
    const copies = await removals.existingConflictCopies(project, [
      "rate-limit.ts",
      "plain.txt",
      "absent.txt",
    ]);
    assert.deepEqual(copies, []);
  });
});
