import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  runSliceCheck,
  runSliceInit,
  runSliceShow,
} from "../../../src/commands/slice/index.js";
import { cleanup, git, makeRepo, put, writeObserved } from "./fixture.js";

afterEach(cleanup);

const all = (r: { messages: string[]; stdout?: string }): string =>
  [...r.messages, r.stdout ?? ""].join("\n");

async function readSlice(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(root, ".hexagen", "slice.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("slice init", () => {
  it("writes a valid slice with commit, creator and the exclude entry", async () => {
    const root = await makeRepo();
    git(
      root,
      "remote",
      "add",
      "origin",
      "https://user:secret@example.test/o/r.git",
    );
    const r = await runSliceInit({
      root,
      paths: ["src/"],
      exclude: ["src/gen/"],
      id: "eng-1",
      yes: true,
    });
    expect(r.exitCode).toBe(0);
    const slice = await readSlice(root);
    expect(slice).toMatchObject({
      id: "eng-1",
      paths: ["src/"],
      excludes: ["src/gen/"],
      createdBy: "t@example.test",
      repo: { commit: git(root, "rev-parse", "HEAD") },
    });
    expect(JSON.stringify(slice)).not.toContain("secret");
    const exclude = await readFile(
      path.join(root, ".git", "info", "exclude"),
      "utf8",
    );
    expect(exclude).toContain(".hexagen/");
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("without --yes lists the writes and writes nothing", async () => {
    const root = await makeRepo();
    const r = await runSliceInit({ root, paths: ["src/"] });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("will write:");
    expect(existsSync(path.join(root, ".hexagen", "slice.json"))).toBe(false);
  });

  it("refuses to overwrite an existing slice", async () => {
    const root = await makeRepo();
    await runSliceInit({ root, paths: ["src/"], yes: true });
    const before = await readFile(
      path.join(root, ".hexagen", "slice.json"),
      "utf8",
    );
    const r = await runSliceInit({ root, paths: ["lib/"], yes: true });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("already exists");
    expect(
      await readFile(path.join(root, ".hexagen", "slice.json"), "utf8"),
    ).toBe(before);
  });

  it.each([
    ["traversal", ["../x/"]],
    ["absolute", ["/etc/"]],
    ["backslash", ["src\\a"]],
    ["empty", [""]],
  ])("refuses a bad path (%s)", async (_n, paths) => {
    const root = await makeRepo();
    const r = await runSliceInit({ root, paths, yes: true });
    expect(r.exitCode).toBe(2);
    expect(existsSync(path.join(root, ".hexagen", "slice.json"))).toBe(false);
  });

  it("refuses no paths, a bad id and a traversing id", async () => {
    const root = await makeRepo();
    expect((await runSliceInit({ root, paths: [], yes: true })).exitCode).toBe(
      2,
    );
    for (const id of ["a..b", "has space", "x".repeat(65)]) {
      const r = await runSliceInit({ root, paths: ["src/"], id, yes: true });
      expect(r.exitCode).toBe(2);
    }
  });

  it("uses --by over git config for createdBy", async () => {
    const root = await makeRepo();
    await runSliceInit({ root, paths: ["src/"], by: "fde-1", yes: true });
    expect((await readSlice(root)).createdBy).toBe("fde-1");
  });
});

describe("slice show", () => {
  it("pretty-prints the slice, and exits 2 when there is none", async () => {
    const root = await makeRepo();
    expect((await runSliceShow({ root })).exitCode).toBe(2);
    await runSliceInit({ root, paths: ["src/"], id: "eng-1", yes: true });
    const r = await runSliceShow({ root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"id": "eng-1"');
  });
});

async function sliceWith(
  files?: string[],
  paths: string[] = ["src/"],
): Promise<string> {
  const root = await makeRepo(files);
  await runSliceInit({ root, paths, id: "s1", yes: true });
  return root;
}

describe("slice check", () => {
  it("is clean when nothing drifted and no edge crosses the boundary", async () => {
    const root = await sliceWith();
    await writeObserved(root, {
      edges: [{ from: "src/a.ts", to: "src/b.ts", specifier: "./b" }],
    });
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(0);
  });

  it("reports a file changed under the slice since the commit", async () => {
    const root = await sliceWith();
    await put(root, "src/a.ts", "changed\n");
    await put(root, "lib/c.ts", "changed\n");
    git(root, "commit", "-q", "-am", "edit");
    await writeObserved(root);
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("src/a.ts");
    expect(all(r)).not.toContain("lib/c.ts");
  });

  it("does not report a change under an excluded path", async () => {
    const root = await makeRepo(["src/a.ts", "src/gen/g.ts"]);
    await runSliceInit({
      root,
      paths: ["src/"],
      exclude: ["src/gen/"],
      yes: true,
    });
    await put(root, "src/gen/g.ts", "changed\n");
    git(root, "commit", "-q", "-am", "edit");
    await writeObserved(root);
    expect((await runSliceCheck({ root })).exitCode).toBe(0);
  });

  it("reports a prefix that matches no files", async () => {
    const root = await sliceWith(undefined, ["src/", "nowhere/"]);
    await writeObserved(root);
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("nowhere/");
  });

  it("reports edges crossing the boundary in both directions", async () => {
    const root = await sliceWith();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
        { from: "lib/c.ts", to: "src/b.ts", specifier: "../src/b" },
      ],
    });
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("src/a.ts -> lib/c.ts");
    expect(all(r)).toContain("lib/c.ts -> src/b.ts");
  });

  it("treats a package-root target as inside a directory slice", async () => {
    const root = await sliceWith(["src/a.ts", "src/pkg/index.ts"]);
    await writeObserved(root, {
      edges: [{ from: "src/a.ts", to: "src/pkg", specifier: "@x/pkg" }],
    });
    expect((await runSliceCheck({ root })).exitCode).toBe(0);
  });

  it("reports incomplete edges when a language was not read (collected true)", async () => {
    const root = await sliceWith();
    await writeObserved(root, { unreadLanguages: ["go"] });
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("incomplete");
    expect(all(r)).toContain("go");
  });

  it("reports incomplete edges when they were not collected", async () => {
    const root = await sliceWith();
    await writeObserved(root, { edgesCollected: false });
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("incomplete");
  });

  it("exits 2 when the slice commit is not in the repository", async () => {
    const root = await sliceWith();
    const file = path.join(root, ".hexagen", "slice.json");
    const slice = JSON.parse(await readFile(file, "utf8"));
    slice.repo.commit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    await put(root, ".hexagen/slice.json", JSON.stringify(slice));
    await writeObserved(root);
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("not in this repository");
  });

  it("exits 2 when observed.json is missing or invalid", async () => {
    const root = await sliceWith();
    expect((await runSliceCheck({ root })).exitCode).toBe(2);
    await put(root, ".hexagen/observed.json", "{}");
    expect((await runSliceCheck({ root })).exitCode).toBe(2);
  });

  it("warns when observed.json is not at HEAD, and fails with --strict", async () => {
    const root = await sliceWith();
    await writeObserved(root);
    await put(root, "lib/c.ts", "more\n");
    git(root, "commit", "-q", "-am", "later");
    const warn = await runSliceCheck({ root });
    expect(warn.exitCode).toBe(0);
    expect(all(warn)).toContain("HEAD");
    const strict = await runSliceCheck({ root, strict: true });
    expect(strict.exitCode).toBe(2);
  });

  it("exits 2 when observed.json predates the slice commit", async () => {
    const root = await makeRepo();
    const old = git(root, "rev-parse", "HEAD");
    await put(root, "lib/c.ts", "more\n");
    git(root, "commit", "-q", "-am", "later");
    await runSliceInit({ root, paths: ["src/"], yes: true });
    await writeObserved(root, { commit: old });
    const r = await runSliceCheck({ root });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("not newer");
  });
});
