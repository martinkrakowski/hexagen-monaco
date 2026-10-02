import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  runContractAddRule,
  runContractCheck,
  runContractPropose,
  runContractShow,
} from "../../../src/commands/contract/index.js";
import { runSliceInit } from "../../../src/commands/slice/index.js";
import { cleanup, git, makeRepo, writeObserved } from "../slice/fixture.js";

afterEach(cleanup);

const all = (r: { messages: string[]; stdout?: string }): string =>
  [...r.messages, r.stdout ?? ""].join("\n");

async function readContract(root: string): Promise<{
  rules: unknown[];
  knownViolations: Record<string, string>[];
  sliceId: string;
}> {
  return JSON.parse(
    await readFile(path.join(root, ".hexagen", "contract.json"), "utf8"),
  );
}

const FILES = [
  "src/a.ts",
  "src/b.ts",
  "ui/x.ts",
  "api/y.ts",
  "lib/c.ts",
  "other/d.go",
  "outside/o.ts",
];

async function setup(
  paths: string[] = ["src/", "ui/", "api/"],
  files: string[] = FILES,
): Promise<string> {
  const root = await makeRepo(files);
  await runSliceInit({ root, paths, id: "s1", yes: true });
  return root;
}

describe("contract propose", () => {
  it("lists in-slice edges that cross slice prefixes, and writes nothing", async () => {
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "src/b.ts", specifier: "./b" },
        { from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y" },
        { from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y.js" },
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
        { from: "lib/c.ts", to: "src/a.ts", specifier: "../src/a" },
      ],
    });
    const r = await runContractPropose({ root });
    expect(r.exitCode).toBe(0);
    const out = all(r);
    expect(out).toContain("ui/ -> api/");
    expect(out).not.toContain("src/ -> src/");
    expect(out).not.toContain("lib/");
    expect(out.match(/ui\/ -> api\//g)).toHaveLength(1);
    await expect(readContract(root)).rejects.toThrow();
  });
});

describe("contract add-rule", () => {
  it("creates contract.json from the slice id and appends later rules", async () => {
    const root = await setup();
    const a = await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "no-ui-api",
      yes: true,
    });
    expect(a.exitCode).toBe(0);
    const b = await runContractAddRule({
      root,
      kind: "allow-only",
      from: "api/",
      to: "src/",
      severity: "warn",
      yes: true,
    });
    expect(b.exitCode).toBe(0);
    const c = await readContract(root);
    expect(c.sliceId).toBe("s1");
    expect(c.rules).toHaveLength(2);
    expect(c.rules[0]).toMatchObject({ id: "no-ui-api", severity: "error" });
    expect(c.rules[1]).toMatchObject({ kind: "allow-only", severity: "warn" });
    expect(
      await readFile(path.join(root, ".git", "info", "exclude"), "utf8"),
    ).toContain(".hexagen/");
  });

  it("refuses the built-in rule id, a duplicate id, bad input and a missing --yes", async () => {
    const root = await setup();
    const base = { root, kind: "forbid" as const, from: "ui/", to: "api/" };
    const builtin = await runContractAddRule({
      ...base,
      id: "unresolved-import",
      yes: true,
    });
    expect(builtin.exitCode).toBe(2);
    expect(all(builtin)).toContain("reserved");
    expect(
      (await runContractAddRule({ ...base, from: "../x/", yes: true }))
        .exitCode,
    ).toBe(2);
    expect(
      (await runContractAddRule({ ...base, id: "has space", yes: true }))
        .exitCode,
    ).toBe(2);
    expect((await runContractAddRule(base)).exitCode).toBe(2);
    await expect(readContract(root)).rejects.toThrow();
    await runContractAddRule({ ...base, id: "r1", yes: true });
    expect(
      (await runContractAddRule({ ...base, id: "r1", yes: true })).exitCode,
    ).toBe(2);
  });

  it("needs a slice", async () => {
    const root = await makeRepo();
    const r = await runContractAddRule({
      root,
      kind: "forbid",
      from: "a/",
      to: "b/",
      yes: true,
    });
    expect(r.exitCode).toBe(2);
  });
});

describe("contract show", () => {
  it("prints the contract, exit 2 without one", async () => {
    const root = await setup();
    expect((await runContractShow({ root })).exitCode).toBe(2);
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r1",
      yes: true,
    });
    const r = await runContractShow({ root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"id": "r1"');
  });
});

describe("contract check: rules", () => {
  it("a forbid rule violation fails and names rule, file and specifier", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "no-ui-api",
      yes: true,
    });
    await writeObserved(root, {
      edges: [
        { from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y" },
        { from: "src/a.ts", to: "api/y.ts", specifier: "../api/y" },
      ],
    });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("no-ui-api");
    expect(all(r)).toContain("ui/x.ts");
    expect(all(r)).toContain("../api/y");
    expect(all(r)).not.toContain("src/a.ts");
  });

  it("an allow-only rule violation fails; edges inside the prefix or to the allowed target pass", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "allow-only",
      from: "ui/",
      to: "src/",
      id: "ui-src-only",
      yes: true,
    });
    await writeObserved(root, {
      edges: [
        { from: "ui/x.ts", to: "src/a.ts", specifier: "../src/a" },
        { from: "ui/x.ts", to: "ui/x.ts", specifier: "./x" },
      ],
    });
    expect((await runContractCheck({ root })).exitCode).toBe(0);
    await writeObserved(root, {
      edges: [{ from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y" }],
    });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("ui-src-only");
  });

  it("a warn rule is reported but does not fail", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "soft",
      severity: "warn",
      yes: true,
    });
    await writeObserved(root, {
      edges: [{ from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y" }],
    });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("soft");
  });

  it("ignores edges whose from is outside the slice", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "lib/",
      to: "api/",
      id: "r",
      yes: true,
    });
    await writeObserved(root, {
      edges: [{ from: "lib/c.ts", to: "api/y.ts", specifier: "../api/y" }],
    });
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("matches a package-root target against a directory prefix", async () => {
    const root = await setup(
      ["src/", "ui/", "api/"],
      [...FILES, "api/pkg/index.ts"],
    );
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/pkg/",
      id: "r",
      yes: true,
    });
    await writeObserved(root, {
      edges: [{ from: "ui/x.ts", to: "api/pkg", specifier: "@x/pkg" }],
    });
    expect((await runContractCheck({ root })).exitCode).toBe(1);
  });
});

describe("contract check: unresolved imports", () => {
  it("an unresolved alias in the slice fails until baselined, then passes", async () => {
    const root = await setup();
    await writeObserved(root, {
      unresolved: [
        { from: "src/a.ts", specifier: "@app/missing", reason: "not-found" },
      ],
    });
    const failing = await runContractCheck({ root });
    expect(failing.exitCode).toBe(1);
    expect(all(failing)).toContain("unresolved-import");
    expect(all(failing)).toContain("src/a.ts");
    expect(all(failing)).toContain("@app/missing");

    expect((await runContractCheck({ root, baseline: true })).exitCode).toBe(2);
    const base = await runContractCheck({ root, baseline: true, yes: true });
    expect(base.exitCode).toBe(0);
    expect((await readContract(root)).knownViolations).toEqual([
      {
        rule: "unresolved-import",
        file: "src/a.ts",
        specifier: "@app/missing",
      },
    ]);
    expect((await runContractCheck({ root })).exitCode).toBe(0);

    await writeObserved(root, {
      unresolved: [
        { from: "src/a.ts", specifier: "@app/missing", reason: "not-found" },
        { from: "src/b.ts", specifier: "@app/other", reason: "not-found" },
      ],
    });
    const again = await runContractCheck({ root });
    expect(again.exitCode).toBe(1);
    expect(all(again)).toContain("@app/other");
    expect(all(again)).not.toContain("@app/missing");
  });

  it.each(["not-scanned", "package-imports", "non-literal"])(
    "a %s row in the slice fails",
    async (reason) => {
      const root = await setup();
      await writeObserved(root, {
        unresolved: [{ from: "src/a.ts", specifier: `<${reason}>`, reason }],
      });
      expect((await runContractCheck({ root })).exitCode).toBe(1);
    },
  );

  it("an unresolved row outside the slice is ignored", async () => {
    const root = await setup();
    await writeObserved(root, {
      unresolved: [
        { from: "lib/c.ts", specifier: "@app/missing", reason: "not-found" },
      ],
    });
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("a Go file in the slice fails when go is an unread language", async () => {
    const root = await setup(["src/", "other/"]);
    await writeObserved(root, { unreadLanguages: ["go"] });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("other/d.go");
    expect(all(r)).toContain("unresolved-import");
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(0);
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("an unread-language file outside the slice does not fail", async () => {
    const root = await setup();
    await writeObserved(root, { unreadLanguages: ["go"] });
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("not-collected edges can never be clean, and cannot be baselined", async () => {
    const root = await setup();
    await writeObserved(root, { edgesCollected: false });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("incomplete");
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(2);
  });
});

describe("contract check: inputs", () => {
  it("exits 2 without observed.json, with a foreign slice id, or with --strict at a stale HEAD", async () => {
    const root = await setup();
    expect((await runContractCheck({ root })).exitCode).toBe(2);
    await writeObserved(root);
    expect((await runContractCheck({ root })).exitCode).toBe(0);
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r",
      yes: true,
    });
    const file = path.join(root, ".hexagen", "contract.json");
    const c = JSON.parse(await readFile(file, "utf8"));
    c.sliceId = "other";
    const { put } = await import("../slice/fixture.js");
    await put(root, ".hexagen/contract.json", JSON.stringify(c));
    expect((await runContractCheck({ root })).exitCode).toBe(2);
    c.sliceId = "s1";
    await put(root, ".hexagen/contract.json", JSON.stringify(c));
    await put(root, "lib/c.ts", "more\n");
    git(root, "commit", "-q", "-am", "later");
    const warn = await runContractCheck({ root });
    expect(warn.exitCode).toBe(0);
    expect(all(warn)).toContain("HEAD");
    expect((await runContractCheck({ root, strict: true })).exitCode).toBe(2);
  });
});
