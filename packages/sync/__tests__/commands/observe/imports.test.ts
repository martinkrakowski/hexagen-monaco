import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ObservedReport, edgesComplete } from "@hexagen/shared";
import { observe } from "../../../src/commands/observe/index.js";
import { runImportPass } from "../../../src/commands/observe/imports/pass.js";

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

  it("notes a file larger than 1 MiB and reports it as not-scanned (F2)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "big.ts": `import './b';\n${"//".padEnd(1024 * 1024, "x")}\n`,
      "b.ts": "export {};\n",
    });
    const { edges, unresolved, report } = await run(root);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([
      {
        from: "big.ts",
        specifier: "<not scanned: larger than 1 MiB>",
        reason: "not-scanned",
      },
    ]);
    expect(report.limits.reasons).toContain(
      "note: big.ts is larger than 1 MiB; not scanned",
    );
    expect(report.limits.truncated).toBe(false);
    expect(ObservedReport.safeParse(report).success).toBe(true);
  });

  it("gives every skipped file a row, past the note cap (F2)", async () => {
    const files: Record<string, string> = { "package.json": '{"name":"p"}' };
    for (let i = 0; i < 55; i++) files[`f${i}.ts`] = "export const a = 1;\n";
    const root = await mkRepo(files);
    const { unresolved, report } = await run(root, {
      maxImportFileBytes: 4,
    });
    expect(unresolved.filter((u) => u.reason === "not-scanned")).toHaveLength(
      55,
    );
    expect(
      report.limits.reasons.some((r) => /more note\(s\) omitted/.test(r)),
    ).toBe(true);
  });

  it("reports an unreadable file as not-scanned (F2)", async () => {
    // root reads anything, and chmod 0 does not hide a file on Windows
    if (process.getuid?.() === 0 || process.platform === "win32") return;
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "locked.ts": "import './b';\n",
      "b.ts": "export {};\n",
    });
    await fs.chmod(path.join(root, "locked.ts"), 0);
    try {
      const { unresolved } = await run(root);
      expect(unresolved).toEqual([
        {
          from: "locked.ts",
          specifier: "<not scanned: unreadable>",
          reason: "not-scanned",
        },
      ]);
    } finally {
      await fs.chmod(path.join(root, "locked.ts"), 0o644);
    }
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

  it("treats a trailing slash as a directory (F5)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "lib.ts": "export {};\n",
      "a.ts": "import './lib/'; import './dir/'; import '.'; import '..';\n",
      "dir/index.ts": "export {};\n",
      "sub/x.ts": "import '..'; import '../';\n",
      "index.ts": "export {};\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges.filter((e) => e.from === "a.ts")).toEqual([
      { from: "a.ts", to: "dir/index.ts", specifier: "./dir/" },
      { from: "a.ts", to: "index.ts", specifier: "." },
    ]);
    expect(unresolved).toContainEqual({
      from: "a.ts",
      specifier: "./lib/",
      reason: "not-found",
    });
    expect(edges.filter((e) => e.from === "sub/x.ts")).toEqual([
      { from: "sub/x.ts", to: "index.ts", specifier: ".." },
      { from: "sub/x.ts", to: "index.ts", specifier: "../" },
    ]);
  });

  it("handles Windows-style specifiers (F6)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts":
        "import 'C:/x'; import 'D:\\\\y'; import '.\\\\z'; import '..\\\\w'; import 'E:x';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([
      { from: "a.ts", specifier: "..\\w", reason: "not-found" },
      { from: "a.ts", specifier: ".\\z", reason: "not-found" },
      { from: "a.ts", specifier: "C:/x", reason: "outside-repo" },
      { from: "a.ts", specifier: "D:\\y", reason: "outside-repo" },
      { from: "a.ts", specifier: "E:x", reason: "outside-repo" },
    ]);
  });

  it("ignores a tsconfig over the size limit, with a note (F7)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@a/*": ["a/*"] } },
        pad: "x".repeat(2000),
      }),
      "a/m.ts": "export {};\n",
      "main.ts": "import '@a/m';\n",
    });
    const { edges, report } = await run(root, { maxImportFileBytes: 1000 });
    expect(edges).toEqual([]);
    expect(report.limits.reasons).toContain(
      "note: tsconfig.json is larger than 1 MiB; ignored",
    );
  });

  it("uses only the last entry of an extends array, with a note (F8)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "one.json": JSON.stringify({
        compilerOptions: { paths: { "@o/*": ["o/*"] } },
      }),
      "two.json": JSON.stringify({
        compilerOptions: { paths: { "@t/*": ["t/*"] } },
      }),
      "tsconfig.json": JSON.stringify({
        extends: ["./one.json", "./two.json"],
      }),
      "o/x.ts": "export {};\n",
      "t/x.ts": "export {};\n",
      "main.ts": "import '@o/x'; import '@t/x';\n",
    });
    const { edges, report } = await run(root);
    expect(edges).toEqual([
      { from: "main.ts", to: "t/x.ts", specifier: "@t/x" },
    ]);
    expect(report.limits.reasons.join("\n")).toMatch(
      /extends array.*last entry/,
    );
  });

  it("treats a __proto__ paths key as an ordinary key (F9)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json":
        '{"compilerOptions":{"paths":{"__proto__":["x"],"@a/*":["a/*"]}}}',
      "x.ts": "export {};\n",
      "a/m.ts": "export {};\n",
      "main.ts": "import '__proto__'; import '@a/m';\n",
    });
    const { edges } = await run(root);
    expect(edges).toEqual([
      { from: "main.ts", to: "a/m.ts", specifier: "@a/m" },
      { from: "main.ts", to: "x.ts", specifier: "__proto__" },
    ]);
  });

  it("falls back from a missed * key to baseUrl, then to external (F12)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "*": ["stubs/*"] } },
      }),
      "stubs/s.ts": "export {};\n",
      "lib/util.ts": "export {};\n",
      "main.ts": "import 's'; import 'lib/util'; import 'react';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([
      { from: "main.ts", to: "lib/util.ts", specifier: "lib/util" },
      { from: "main.ts", to: "stubs/s.ts", specifier: "s" },
    ]);
    expect(unresolved).toEqual([]);
  });

  it("resolves a bare baseUrl-relative import (F12)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
      "src/util.ts": "export {};\n",
      "src/deep/main.ts": "import 'util'; import 'nope';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([
      { from: "src/deep/main.ts", to: "src/util.ts", specifier: "util" },
    ]);
    expect(unresolved).toEqual([]);
  });

  it("maps .jsx, .mjs and .cjs to their TypeScript sources (F12)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "c.tsx": "export {};\n",
      "m.mts": "export {};\n",
      "k.cts": "export {};\n",
      "a.ts": "import './c.jsx'; import './m.mjs'; import './k.cjs';\n",
    });
    const { edges } = await run(root);
    expect(edges.map((e) => e.to)).toEqual(["c.tsx", "k.cts", "m.mts"]);
  });

  it("follows an extends chain to 5 levels past the nearest file, and no further (F12)", async () => {
    const chain = (
      n: number,
      depthWithPaths: number,
    ): Record<string, string> => {
      const files: Record<string, string> = {};
      for (let i = 0; i <= n; i++) {
        const name = i === 0 ? "tsconfig.json" : `t${i}.json`;
        files[name] = JSON.stringify({
          ...(i < n ? { extends: `./t${i + 1}.json` } : {}),
          ...(i === depthWithPaths
            ? { compilerOptions: { paths: { "@d/*": ["d/*"] } } }
            : {}),
        });
      }
      return files;
    };
    const base = {
      "package.json": '{"name":"p"}',
      "d/x.ts": "export {};\n",
      "main.ts": "import '@d/x';\n",
    };
    const within = await mkRepo({ ...base, ...chain(7, 5) });
    expect((await run(within)).edges).toEqual([
      { from: "main.ts", to: "d/x.ts", specifier: "@d/x" },
    ]);
    const beyond = await mkRepo({ ...base, ...chain(7, 6) });
    const r = await run(beyond);
    expect(r.edges).toEqual([]);
    expect(r.report.limits.reasons.join("\n")).toMatch(/deeper than 5/);
  });

  it("does not take @acme/core-extra for a subpath of @acme/core (F12)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "packages/core/package.json": '{"name":"@acme/core"}',
      "a.ts": "import '@acme/core-extra'; import '@acme/core';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([
      { from: "a.ts", to: "packages/core", specifier: "@acme/core" },
    ]);
    expect(unresolved).toEqual([]);
  });

  it("trips the byte cap while loading a tsconfig, not only while scanning (bot 3)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@a/*": ["a/*"] } },
        pad: "x".repeat(400),
      }),
      "a.ts": "export {};\n",
    });
    // The source is tiny; only the tsconfig can push the total over the cap.
    const report = await observe({ root, maxImportBytes: 100 });
    expect(report.edges).toEqual({
      collected: false,
      reason: "import pass byte cap reached (maxImportBytes=100)",
    });
    expect(report.unresolved.collected).toBe(false);
    expect(report.limits.truncated).toBe(true);
  });

  it("trips the time cap while loading a tsconfig chain (bot 3)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({ extends: "./b.json" }),
      "b.json": JSON.stringify({ extends: "./c.json" }),
      // c extends b again: only reached if loading ignores the time cap.
      "c.json": JSON.stringify({ extends: "./b.json" }),
      "a.ts": "export {};\n",
    });
    let t = 0;
    // 600 ms per read: the third read inside config loading is past 1000 ms.
    const report = await observe({
      root,
      maxMs: 10_000_000,
      maxImportMs: 1000,
      now: () => (t += 600),
    });
    expect(report.edges).toEqual({
      collected: false,
      reason: "import pass time cap reached (maxImportMs=1000)",
    });
    expect(report.unresolved.collected).toBe(false);
    expect(report.limits.reasons.join("\n")).not.toMatch(/extends cycle/);
  });

  it("reports a file swapped for a symlink after the walk as not-scanned (bot 4)", async () => {
    if (process.platform === "win32") return;
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "b.ts": "export {};\n",
    });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-out-"));
    tmpDirs.push(outside);
    await put(outside, "secret.ts", "import './b';\n");
    await fs.symlink(path.join(outside, "secret.ts"), path.join(root, "a.ts"));
    const notes: string[] = [];
    const result = await runImportPass({
      root,
      files: ["a.ts", "b.ts"],
      packages: [],
      maxFiles: 100,
      maxBytes: 1_000_000,
      maxMs: 100_000,
      now: () => 0,
      start: 0,
      notes,
    });
    expect(result).toEqual({
      collected: true,
      edges: [],
      unresolved: [
        {
          from: "a.ts",
          specifier: "<not scanned: unreadable>",
          reason: "not-scanned",
        },
      ],
    });
  });

  it("tries a tsconfig alias before calling a workspace subpath exports-subpath (bot 6)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@acme/core/*": ["packages/core/src/*"] } },
      }),
      "packages/core/package.json": '{"name":"@acme/core"}',
      "packages/core/src/util.ts": "export {};\n",
      "a.ts": "import '@acme/core/util'; import '@acme/core/other';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([
      {
        from: "a.ts",
        to: "packages/core/src/util.ts",
        specifier: "@acme/core/util",
      },
    ]);
    // The alias matched but the target is absent: that is the alias's verdict.
    expect(unresolved).toEqual([
      { from: "a.ts", specifier: "@acme/core/other", reason: "not-found" },
    ]);
  });

  it("keeps an escaped or empty static specifier as a non-literal row (bot 7)", async () => {
    const root = await mkRepo({
      "package.json": '{"name":"p"}',
      "a.ts": "import '\\u0061'; export * from '';\n",
    });
    const { edges, unresolved } = await run(root);
    expect(edges).toEqual([]);
    expect(unresolved).toEqual([
      {
        from: "a.ts",
        specifier: "export <non-literal>",
        reason: "non-literal",
      },
      {
        from: "a.ts",
        specifier: "import <non-literal>",
        reason: "non-literal",
      },
    ]);
  });
});
