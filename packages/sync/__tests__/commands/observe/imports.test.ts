import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObservedReport, edgesComplete } from "@hexagen/shared";
import { observe } from "../../../src/commands/observe/index.js";

const tmpDirs: string[] = [];

async function put(root: string, rel: string, body: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
}

async function mkRepo(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-imports-"));
  tmpDirs.push(root);
  for (const [rel, body] of Object.entries(files)) await put(root, rel, body);
  const g = (...args: string[]): void => {
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: root, stdio: "ignore" },
    );
  };
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "fixture", "--no-gpg-sign");
  return root;
}

async function hashTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function rec(dir: string): Promise<void> {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(root, p);
      if (e.isDirectory()) {
        out[rel + "/"] = "dir";
        await rec(p);
      } else {
        out[rel] = createHash("sha256")
          .update(await fs.readFile(p))
          .digest("hex");
      }
    }
  }
  await rec(root);
  return out;
}

afterEach(async () => {
  while (tmpDirs.length) {
    await fs.rm(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

type Edge = { from: string; to: string; specifier: string };
type Unres = { from: string; specifier: string; reason: string };

async function run(
  root: string,
  extra: Partial<Parameters<typeof observe>[0]> = {},
): Promise<{
  edges: Edge[];
  unresolved: Unres[];
  report: Awaited<ReturnType<typeof observe>>;
}> {
  const report = await observe({ root, ...extra });
  if (!report.edges.collected || !report.unresolved.collected) {
    throw new Error("import pass not collected");
  }
  return {
    edges: report.edges.items,
    unresolved: report.unresolved.items,
    report,
  };
}

/** A monorepo with a workspace package, a tsconfig alias and the usual traps. */
const MONO: Record<string, string> = {
  "package.json": JSON.stringify({ name: "mono", private: true }),
  "tsconfig.json": JSON.stringify({
    // comments and trailing commas are legal in a tsconfig
    compilerOptions: { baseUrl: ".", paths: { "@app/*": ["apps/web/src/*"] } },
  }),
  "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
  "packages/core/src/index.ts": "export const core = 1;\n",
  "apps/web/package.json": JSON.stringify({ name: "web" }),
  "apps/web/src/util.ts": "export const u = 1;\n",
  "apps/web/src/lib/index.ts": "export const l = 1;\n",
  "apps/web/src/legacy.ts": "export const old = 1;\n",
  "apps/web/src/main.ts": [
    "import { u } from './util.js';", // .js maps to .ts
    "import { l } from './lib';", // index file
    "import { core } from '@acme/core';", // workspace package
    "import { sub } from '@acme/core/internal';", // exports subpath
    "import { f } from '@app/legacy';", // tsconfig paths alias
    "import { g } from '@app/missing';", // alias, not found
    "import fs from 'node:fs';", // builtin
    "import path from 'path';", // builtin
    "import React from 'react';", // dependency
    "import up from '../../../../../outside';", // escapes the repo
    "import '../../../apps/web/src/util';", // normalizes back inside
    "const dyn = await import(someVariable);", // non-literal
    "// import c from './in-comment';",
    "const t = `import x from './in-template'`;",
    "import { u as again } from './util.js';", // exact repeat
    "",
  ].join("\n"),
};

describe("hexagen observe: import pass", () => {
  it("resolves relative, workspace, alias and reports the rest with a reason", async () => {
    const root = await mkRepo(MONO);
    const { edges, unresolved, report } = await run(root);
    const from = "apps/web/src/main.ts";
    expect(edges.filter((e) => e.from === from)).toEqual([
      { from, to: "apps/web/src/legacy.ts", specifier: "@app/legacy" },
      { from, to: "apps/web/src/lib/index.ts", specifier: "./lib" },
      {
        from,
        to: "apps/web/src/util.ts",
        specifier: "../../../apps/web/src/util",
      },
      { from, to: "apps/web/src/util.ts", specifier: "./util.js" },
      { from, to: "packages/core", specifier: "@acme/core" },
    ]);
    expect(unresolved.filter((u) => u.from === from)).toEqual([
      { from, specifier: "../../../../../outside", reason: "outside-repo" },
      { from, specifier: "@acme/core/internal", reason: "exports-subpath" },
      { from, specifier: "@app/missing", reason: "not-found" },
      { from, specifier: "import(<non-literal>)", reason: "non-literal" },
    ]);
    expect(ObservedReport.safeParse(report).success).toBe(true);
  });

  it("neither records nor reports builtins and dependencies, and counts them in one note", async () => {
    const root = await mkRepo(MONO);
    const { edges, unresolved, report } = await run(root);
    const text = JSON.stringify({ edges, unresolved });
    expect(text).not.toMatch(/node:fs|"path"|react/);
    const notes = report.limits.reasons.filter((r) =>
      r.includes("external specifier"),
    );
    expect(notes).toEqual([
      "note: 3 external specifier(s) (node builtins and dependencies) are neither edges nor unresolved",
    ]);
  });

  it("ignores specifiers in comments and templates", async () => {
    const root = await mkRepo(MONO);
    const { edges, unresolved } = await run(root);
    const text = JSON.stringify({ edges, unresolved });
    expect(text).not.toContain("in-comment");
    expect(text).not.toContain("in-template");
  });

  it("deduplicates exact repeats", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts":
        "import './b'; import './b'; require('./b.ts');\nimport('./b');\n",
      "b.ts": "export {};\n",
    });
    const { edges } = await run(root);
    expect(edges).toEqual([
      { from: "a.ts", to: "b.ts", specifier: "./b" },
      { from: "a.ts", to: "b.ts", specifier: "./b.ts" },
    ]);
  });

  it("tries relative before the tsconfig map, and a workspace package before it", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "*": ["stubs/*"], "@acme/core": ["stubs/core"] },
        },
      }),
      "stubs/a.ts": "export {};\n",
      "stubs/core.ts": "export {};\n",
      "src/a.ts": "export {};\n",
      "src/main.ts": "import './a'; import '@acme/core';\n",
      "packages/core/package.json": '{"name":"@acme/core"}',
    });
    const { edges } = await run(root);
    expect(edges.filter((e) => e.from === "src/main.ts")).toEqual([
      { from: "src/main.ts", to: "packages/core", specifier: "@acme/core" },
      { from: "src/main.ts", to: "src/a.ts", specifier: "./a" },
    ]);
  });

  it("uses the nearest tsconfig only, follows extends inside the repo, and notes a cycle", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@root/*": ["root/*"] } },
      }),
      "root/x.ts": "export {};\n",
      "base/tsconfig.base.json": JSON.stringify({
        extends: "./tsconfig.loop.json",
        compilerOptions: { baseUrl: "../lib", paths: { "@lib/*": ["*"] } },
      }),
      "base/tsconfig.loop.json": JSON.stringify({
        extends: "./tsconfig.base.json",
      }),
      "lib/y.ts": "export {};\n",
      "pkg/tsconfig.json": JSON.stringify({
        extends: "../base/tsconfig.base.json",
      }),
      "pkg/a.ts": "import '@lib/y'; import '@root/x';\n",
      "pkg2/tsconfig.json": JSON.stringify({
        extends: "@tsconfig/node18/tsconfig.json",
      }),
      "pkg2/b.ts": "import '@root/x';\n",
    });
    const { edges, unresolved, report } = await run(root);
    // pkg/ inherits @lib/* through extends and does NOT see the root's @root/*.
    expect(edges).toEqual([
      { from: "pkg/a.ts", to: "lib/y.ts", specifier: "@lib/y" },
    ]);
    expect(unresolved).toEqual([]);
    expect(report.limits.reasons.join("\n")).toMatch(/extends cycle/);
    expect(report.limits.reasons.join("\n")).toMatch(
      /@tsconfig\/node18.*not a repo-relative path/,
    );
  });

  it("never follows extends outside the repo", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({ extends: "../shared.json" }),
      "a.ts": "import '@x/y';\n",
    });
    const { edges, unresolved, report } = await run(root);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([]);
    expect(report.limits.reasons.join("\n")).toMatch(/outside the repo/);
  });

  it("reports an alias that escapes the repo as outside-repo", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@out/*": ["../elsewhere/*"] } },
      }),
      "a.ts": "import '@out/z';\n",
    });
    const { unresolved } = await run(root);
    expect(unresolved).toEqual([
      { from: "a.ts", specifier: "@out/z", reason: "outside-repo" },
    ]);
  });

  it("reports a # import as unresolved rather than dropping it", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "import '#internal/x';\n",
    });
    const { unresolved } = await run(root);
    expect(unresolved).toEqual([
      { from: "a.ts", specifier: "#internal/x", reason: "package-imports" },
    ]);
  });

  it('resolves an import of the root package by its name to "."', async () => {
    const root = await mkRepo({
      "package.json": '{"name":"@acme/solo"}',
      "src/a.ts": "import '@acme/solo';\n",
    });
    const { edges } = await run(root);
    expect(edges).toEqual([
      { from: "src/a.ts", to: ".", specifier: "@acme/solo" },
    ]);
  });

  it("does not map a package that declares no name", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "apps/noname/package.json": '{"private":true}',
      "src/a.ts": "import 'apps/noname';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it("lists unread languages, so a Go file makes edgesComplete false", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "export {};\n",
      "cmd/main.go": "package main\n",
      "lib/x.py": "x = 1\n",
    });
    const { report } = await run(root);
    if (!report.edges.collected) throw new Error("not collected");
    expect(report.edges.unreadLanguages).toEqual(["go", "py"]);
    expect(edgesComplete(report.edges)).toBe(false);
  });

  it("has no unread languages for a JS/TS-only repo", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "export {};\n",
      "b.mjs": "export {};\n",
    });
    const { report } = await run(root);
    if (!report.edges.collected) throw new Error("not collected");
    expect(report.edges.unreadLanguages).toEqual([]);
    expect(edgesComplete(report.edges)).toBe(true);
  });

  it("trips the file cap with collected:false and a reason", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "import './b';\n",
      "b.ts": "export {};\n",
      "c.ts": "export {};\n",
    });
    const report = await observe({ root, maxImportFiles: 2 });
    const reason = "import pass file cap reached (maxImportFiles=2)";
    expect(report.edges).toEqual({ collected: false, reason });
    expect(report.unresolved).toEqual({ collected: false, reason });
    expect(report.limits.truncated).toBe(true);
    expect(report.limits.reasons).toContain(reason);
    // The walk's own sections are unaffected.
    expect(report.packages.collected).toBe(true);
    expect(ObservedReport.safeParse(report).success).toBe(true);
  });

  it("trips the byte cap", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": `import './b';\n${"// pad\n".repeat(50)}`,
      "b.ts": "export {};\n",
    });
    const report = await observe({ root, maxImportBytes: 100 });
    expect(report.edges).toEqual({
      collected: false,
      reason: "import pass byte cap reached (maxImportBytes=100)",
    });
    expect(report.limits.truncated).toBe(true);
  });

  it("trips the time cap, and starts its own clock after the walk", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "import './b';\n",
      "b.ts": "export {};\n",
    });
    let t = 0;
    const report = await observe({
      root,
      maxImportMs: 5,
      now: () => (t += 10),
    });
    expect(report.edges).toEqual({
      collected: false,
      reason: "import pass time cap reached (maxImportMs=5)",
    });
    expect(report.limits.truncated).toBe(true);
  });

  it("notes and skips a file larger than 1 MiB", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "big.ts": `import './b';\n${"//".padEnd(1024 * 1024, "x")}\n`,
      "b.ts": "export {};\n",
    });
    const { edges, report } = await run(root);
    expect(edges).toEqual([]);
    expect(report.limits.reasons).toContain(
      "note: big.ts is larger than 1 MiB; not scanned",
    );
    expect(report.limits.truncated).toBe(false);
  });

  it("leaves edges and unresolved not collected when the walk is truncated", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "export {};\n",
      "b.ts": "export {};\n",
      "c.ts": "export {};\n",
    });
    const report = await observe({ root, maxFiles: 2 });
    expect(report.edges.collected).toBe(false);
    expect(report.unresolved.collected).toBe(false);
    expect(ObservedReport.safeParse(report).success).toBe(true);
  });

  it("leaves the tree byte-identical", async () => {
    const root = await mkRepo(MONO);
    const before = await hashTree(root);
    await observe({ root });
    expect(await hashTree(root)).toEqual(before);
  });
});
