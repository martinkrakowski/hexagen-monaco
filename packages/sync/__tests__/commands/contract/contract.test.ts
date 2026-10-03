import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  runContractAddRule,
  runContractCheck,
  runContractPropose,
  runContractShow,
} from "../../../src/commands/contract/index.js";
import { isSuppressionExpired } from "../../../src/commands/contract/evaluate.js";
import { runSliceInit } from "../../../src/commands/slice/index.js";
import {
  cleanup,
  git,
  makeRepo,
  put,
  writeObserved,
} from "../slice/fixture.js";

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

describe("contract check: expiry and root package", () => {
  async function baselined(expires: string): Promise<string> {
    const root = await setup();
    await writeObserved(root, {
      unresolved: [
        { from: "src/a.ts", specifier: "@app/missing", reason: "not-found" },
      ],
    });
    await runContractCheck({ root, baseline: true, yes: true });
    const c = await readContract(root);
    c.knownViolations[0]!.expires = expires;
    const { put } = await import("../slice/fixture.js");
    await put(root, ".hexagen/contract.json", JSON.stringify(c));
    return root;
  }

  it("an expired baseline entry no longer hides its violation", async () => {
    const root = await baselined("2020-01-01");
    expect((await runContractCheck({ root })).exitCode).toBe(1);
  });

  it("an entry that expires today is still valid", async () => {
    const root = await baselined(new Date().toISOString().slice(0, 10));
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("isSuppressionExpired is inclusive to the end of the UTC day", () => {
    expect(
      isSuppressionExpired("2026-10-01", new Date("2026-10-01T23:59:59.999Z")),
    ).toBe(false);
    expect(
      isSuppressionExpired("2026-10-01", new Date("2026-10-02T00:00:00.000Z")),
    ).toBe(true);
    expect(() => isSuppressionExpired("2026-02-30")).toThrow();
  });

  it("a root-package target always violates allow-only", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "allow-only",
      from: "ui/",
      to: "src/",
      id: "r",
      yes: true,
    });
    await writeObserved(root, {
      edges: [{ from: "ui/x.ts", to: ".", specifier: "root-pkg" }],
    });
    expect((await runContractCheck({ root })).exitCode).toBe(1);
  });

  it("exits 2 from a subdirectory root", async () => {
    const root = await setup();
    await writeObserved(root);
    const sub = await runContractCheck({ root: path.join(root, "src") });
    expect(sub.exitCode).toBe(2);
    expect(all(sub)).toContain("top level");
  });
});

describe("contract: review round 3", () => {
  const unresolved = [
    { from: "src/a.ts", specifier: "@app/missing", reason: "not-found" },
  ];

  async function withEntry(expires: string): Promise<string> {
    const root = await setup();
    await writeObserved(root, { unresolved });
    await runContractCheck({ root, baseline: true, yes: true });
    const c = await readContract(root);
    c.knownViolations[0]!.expires = expires;
    await put(root, ".hexagen/contract.json", JSON.stringify(c));
    return root;
  }

  it("an impossible expires date exits 2 and names the entry", async () => {
    const root = await withEntry("2026-02-30");
    for (const run of [
      () => runContractCheck({ root }),
      () => runContractShow({ root }),
    ]) {
      const r = await run();
      expect(r.exitCode).toBe(2);
      expect(all(r)).toContain("@app/missing");
      expect(all(r)).toContain("2026-02-30");
    }
  });

  it("an impossible expires date fails at the schema, never reports clean", async () => {
    const root = await withEntry("2026-02-30");
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("does not match its schema");
    expect(all(r)).toContain("not a real calendar date");
    expect(all(r)).toContain("2026-02-30");
  });

  it("re-baselining drops an expired date, so the violation is hidden again", async () => {
    const root = await withEntry("2020-01-01");
    expect((await runContractCheck({ root })).exitCode).toBe(1);
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(0);
    expect((await readContract(root)).knownViolations[0]).not.toHaveProperty(
      "expires",
    );
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("re-baselining keeps a still-valid date", async () => {
    const root = await withEntry("2999-01-01");
    await runContractCheck({ root, baseline: true, yes: true });
    expect((await readContract(root)).knownViolations[0]).toMatchObject({
      expires: "2999-01-01",
    });
  });

  it("contract show refuses from a subdirectory", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r",
      yes: true,
    });
    const r = await runContractShow({ root: path.join(root, "src") });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("top level");
  });

  it("add-rule and baseline exit 2 while the lock is held, leaving the contract unchanged", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r1",
      yes: true,
    });
    const file = path.join(root, ".hexagen", "contract.json");
    const before = await readFile(file, "utf8");
    await put(root, ".hexagen/contract.json.lock", "99999\n");
    const add = await runContractAddRule({
      root,
      kind: "forbid",
      from: "src/",
      to: "api/",
      id: "r2",
      yes: true,
    });
    expect(add.exitCode).toBe(2);
    expect(all(add)).toContain("another contract command is running");
    await writeObserved(root, { unresolved });
    const base = await runContractCheck({ root, baseline: true, yes: true });
    expect(base.exitCode).toBe(2);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(file + ".lock", "utf8")).toBe("99999\n");
  });

  it("removes its lock after a run, including a refused one", async () => {
    const root = await setup();
    const lock = path.join(root, ".hexagen", "contract.json.lock");
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r1",
      yes: true,
    });
    expect(existsSync(lock)).toBe(false);
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r1",
      yes: true,
    });
    expect(existsSync(lock)).toBe(false);
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

// ── contract check --base: the growth guard ──────────────────────────────────
//
// Every writer of `.hexagen/` adds it to the repo exclude file, so the guard can
// only read a base when the client staged the sidecar (`workbook export
// --stage`, or `git add -f`). `staged()` does that, which is what makes these
// cases reachable at all.
interface BaseFixture {
  rules?: Record<string, string>[];
  knownViolations?: Record<string, string>[];
  excludes?: string[];
  /** Leave contract.json out of the base commit (default: stage it). */
  stageContract?: boolean;
  /** Write observed.json in the working tree (default true). */
  observed?: boolean;
}

const RULE = {
  id: "no-ui-api",
  kind: "forbid",
  from: "ui/",
  to: "api/",
  severity: "error",
};

const ENTRY = {
  rule: "unresolved-import",
  file: "src/a.ts",
  specifier: "@app/missing",
  reason: "vendor shim",
};

const UNRESOLVED = [
  { from: "src/a.ts", specifier: "@app/missing", reason: "not-found" },
];

interface TreeContract {
  schemaVersion: string;
  sliceId: string;
  rules: Record<string, string>[];
  knownViolations: Record<string, string>[];
}

const contractFile = (root: string): string =>
  path.join(root, ".hexagen", "contract.json");

async function readTreeContract(root: string): Promise<TreeContract> {
  return JSON.parse(await readFile(contractFile(root), "utf8"));
}

async function writeTreeContract(
  root: string,
  next: TreeContract,
): Promise<void> {
  await put(
    root,
    ".hexagen/contract.json",
    `${JSON.stringify(next, null, 2)}\n`,
  );
}

/** A repo whose slice (and by default contract) are in the HEAD commit. */
async function staged(opts: BaseFixture = {}): Promise<string> {
  const root = await makeRepo(FILES);
  await runSliceInit({
    root,
    paths: ["src/", "ui/", "api/"],
    exclude: opts.excludes,
    id: "s1",
    yes: true,
  });
  await writeTreeContract(root, {
    schemaVersion: "1.0.0",
    sliceId: "s1",
    rules: opts.rules ?? [RULE],
    knownViolations: opts.knownViolations ?? [],
  });
  git(root, "add", "-f", ".hexagen/slice.json");
  if (opts.stageContract !== false) {
    git(root, "add", "-f", ".hexagen/contract.json");
  }
  git(root, "commit", "-q", "-m", "stage the baseline");
  if (opts.observed !== false) await writeObserved(root);
  return root;
}

async function addTreeExclude(root: string, entry: string): Promise<void> {
  const file = path.join(root, ".hexagen", "slice.json");
  const slice = JSON.parse(await readFile(file, "utf8")) as {
    excludes: string[];
  };
  await put(
    root,
    ".hexagen/slice.json",
    `${JSON.stringify({ ...slice, excludes: [...slice.excludes, entry] }, null, 2)}\n`,
  );
}

/** Each row of the growth table: what the base holds, and how the tree weakens it. */
const GROWTH_ROWS: Array<{
  name: string;
  base?: BaseFixture;
  weaken: (root: string) => Promise<void>;
}> = [
  {
    name: "a new knownViolations entry",
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations.push({ ...ENTRY });
      await writeTreeContract(root, c);
    },
  },
  {
    name: "an expires pushed later",
    base: { knownViolations: [{ ...ENTRY, expires: "2026-12-01" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations[0]!.expires = "2027-12-01";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "an expires dropped",
    base: { knownViolations: [{ ...ENTRY, expires: "2026-12-01" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations = [{ ...ENTRY }];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a removed rule",
    base: { rules: [RULE, { ...RULE, id: "no-ui-lib" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules = c.rules.filter((r) => r.id !== "no-ui-lib");
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a severity downgraded to warn",
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.severity = "warn";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a rule field edited",
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.to = "api/legacy/";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a new slice exclude",
    weaken: (root) => addTreeExclude(root, "api/legacy/"),
  },
];

describe("contract check --base: the growth guard", () => {
  it("1. a new knownViolations entry fails against the base", async () => {
    const root = await staged();
    const c = await readTreeContract(root);
    c.knownViolations.push({ ...ENTRY, file: "src/b.ts" });
    await writeTreeContract(root, c);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("growth");
    expect(all(r)).toContain("src/b.ts");
    expect(all(r)).toContain("@app/missing");
  });

  it("2. a removed entry passes", async () => {
    const root = await staged({ knownViolations: [{ ...ENTRY }] });
    const c = await readTreeContract(root);
    c.knownViolations = [];
    await writeTreeContract(root, c);
    expect((await runContractCheck({ root, base: "HEAD" })).exitCode).toBe(0);
  });

  it("3. an expires pushed later fails as growth", async () => {
    const root = await staged({
      knownViolations: [{ ...ENTRY, expires: "2026-12-01" }],
    });
    const c = await readTreeContract(root);
    c.knownViolations[0]!.expires = "2027-12-01";
    await writeTreeContract(root, c);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("expires");
    expect(all(r)).toContain("2027-12-01");
  });

  it("4. --allow-growth without --reason (and without --base) exits 2", async () => {
    const root = await staged();
    const c = await readTreeContract(root);
    c.knownViolations.push({ ...ENTRY });
    await writeTreeContract(root, c);
    const noReason = await runContractCheck({
      root,
      base: "HEAD",
      allowGrowth: true,
    });
    expect(noReason.exitCode).toBe(2);
    expect(all(noReason)).toContain("--reason");
    const noBase = await runContractCheck({
      root,
      allowGrowth: true,
      reason: "x",
    });
    expect(noBase.exitCode).toBe(2);
    expect(all(noBase)).toContain("--base");
  });

  it("5. an unresolvable base ref exits 2, never 0", async () => {
    const root = await staged();
    for (const base of ["no-such-ref", "HEAD~99", "v1.2.3"]) {
      const r = await runContractCheck({ root, base });
      expect(r.exitCode, base).toBe(2);
      expect(all(r), base).toContain(base);
      // The two exit-2 causes must stay apart: GitReader.show returns null for
      // both, so only resolving the ref first tells them apart.
      expect(all(r), base).toContain("cannot resolve");
      expect(all(r), base).not.toContain("never staged");
    }
  });

  it("6. a contract.json absent at the base exits 2 and says it was never staged", async () => {
    const root = await staged({ stageContract: false });
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("contract.json");
    expect(all(r)).toContain("absent at base because it was never staged");
    expect(all(r)).not.toContain("first commit");
  });

  it("7. a violation baselined at the base still passes without --base", async () => {
    const root = await staged({ knownViolations: [{ ...ENTRY }] });
    await writeObserved(root, { unresolved: UNRESOLVED });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("1 known violation");
  });

  it("8. a deleted rules[] entry fails as growth and names the id", async () => {
    const root = await staged({
      rules: [RULE, { ...RULE, id: "no-ui-lib" }],
    });
    const c = await readTreeContract(root);
    c.rules = c.rules.filter((r) => r.id !== "no-ui-lib");
    await writeTreeContract(root, c);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("no-ui-lib");
    expect(all(r)).toContain("removed");
  });

  it("9. a severity downgraded to warn fails as growth, naming id and field", async () => {
    const root = await staged();
    const c = await readTreeContract(root);
    c.rules[0]!.severity = "warn";
    await writeTreeContract(root, c);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("no-ui-api");
    expect(all(r)).toContain("severity");
  });

  it("10. editing a rule's from or to fails as growth, including a narrowing", async () => {
    for (const edit of [
      { field: "from", was: "ui/", now: "ui/ui/" },
      { field: "to", was: "api/", now: "api/legacy/" },
    ]) {
      const root = await staged();
      const c = await readTreeContract(root);
      c.rules[0]![edit.field] = edit.now;
      await writeTreeContract(root, c);
      const r = await runContractCheck({ root, base: "HEAD" });
      expect(r.exitCode, edit.field).toBe(1);
      expect(all(r), edit.field).toContain("no-ui-api");
      expect(all(r), edit.field).toContain(edit.field);
      expect(all(r), edit.field).toContain(edit.was);
    }
  });

  it("11. a new slice exclude fails as growth", async () => {
    const root = await staged();
    await addTreeExclude(root, "api/legacy/");
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("api/legacy/");
    expect(all(r)).toContain("exclude");
  });

  it("12. an expires dropped in the tree fails as growth, including the --baseline drop", async () => {
    const root = await staged({
      knownViolations: [{ ...ENTRY, expires: "2999-01-01" }],
    });
    const c = await readTreeContract(root);
    c.knownViolations = [{ ...ENTRY }];
    await writeTreeContract(root, c);
    const direct = await runContractCheck({ root, base: "HEAD" });
    expect(direct.exitCode).toBe(1);
    expect(all(direct)).toContain("expires");
    expect(all(direct)).toContain("@app/missing");

    // The same drop with no flag and no message: re-baselining discards a date
    // that has passed. The guard is what makes it visible.
    const rebased = await staged({
      knownViolations: [{ ...ENTRY, expires: "2020-01-01" }],
    });
    await writeObserved(rebased, { unresolved: UNRESOLVED });
    expect(
      (await runContractCheck({ root: rebased, baseline: true, yes: true }))
        .exitCode,
    ).toBe(0);
    expect(
      (await readTreeContract(rebased)).knownViolations[0],
    ).not.toHaveProperty("expires");
    const r = await runContractCheck({ root: rebased, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("expires");
    expect(all(r)).toContain("@app/missing");
  });

  it("13. a shortened expires and a removed entry are not growth", async () => {
    const shorter = await staged({
      knownViolations: [{ ...ENTRY, expires: "2999-01-01" }],
    });
    const c = await readTreeContract(shorter);
    c.knownViolations[0]!.expires = "2026-01-01";
    await writeTreeContract(shorter, c);
    expect(
      (await runContractCheck({ root: shorter, base: "HEAD" })).exitCode,
    ).toBe(0);

    const dropped = await staged({ knownViolations: [{ ...ENTRY }] });
    const c2 = await readTreeContract(dropped);
    c2.knownViolations = [];
    await writeTreeContract(dropped, c2);
    expect(
      (await runContractCheck({ root: dropped, base: "HEAD" })).exitCode,
    ).toBe(0);
  });

  it.each(GROWTH_ROWS)(
    "14. --allow-growth --reason accepts $name at exit 0",
    async ({ name, base, weaken }) => {
      const root = await staged(base);
      await weaken(root);
      expect((await runContractCheck({ root, base: "HEAD" })).exitCode).toBe(1);
      const reason = `reviewed: ${name}`;
      const r = await runContractCheck({
        root,
        base: "HEAD",
        allowGrowth: true,
        reason,
      });
      expect(r.exitCode).toBe(0);
      expect(all(r)).toContain(reason);
    },
  );

  it("15. growth is reported with no observed.json, so the stale-input exit does not mask it", async () => {
    const root = await staged({ observed: false });
    const c = await readTreeContract(root);
    c.knownViolations.push({ ...ENTRY });
    await writeTreeContract(root, c);
    expect(existsSync(path.join(root, ".hexagen", "observed.json"))).toBe(
      false,
    );
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("@app/missing");
    expect(all(r)).not.toContain("does not exist");
  });

  it("16. --base with --baseline exits 2 and writes nothing", async () => {
    const root = await staged();
    const before = await readFile(contractFile(root), "utf8");
    const r = await runContractCheck({
      root,
      base: "HEAD",
      baseline: true,
      yes: true,
    });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("--base");
    expect(all(r)).toContain("--baseline");
    expect(await readFile(contractFile(root), "utf8")).toBe(before);
    expect(existsSync(`${contractFile(root)}.lock`)).toBe(false);
  });

  it("18. a base file that cannot be read exits 2, never 0", async () => {
    const good = {
      schemaVersion: "1.0.0",
      sliceId: "s1",
      rules: [RULE],
      knownViolations: [],
    };

    const broken = await staged();
    await put(broken, ".hexagen/contract.json", "{oops\n");
    git(broken, "add", "-f", ".hexagen/contract.json");
    git(broken, "commit", "-q", "-m", "bad json at the base");
    await writeTreeContract(broken, good);
    const badJson = await runContractCheck({ root: broken, base: "HEAD" });
    expect(badJson.exitCode).toBe(2);
    expect(all(badJson)).toContain("not valid JSON");

    const offSchema = await staged();
    await writeTreeContract(offSchema, {
      ...good,
      rules: [{ ...RULE, unexpected: "field" }],
    } as unknown as TreeContract);
    git(offSchema, "add", "-f", ".hexagen/contract.json");
    git(offSchema, "commit", "-q", "-m", "off-schema base");
    await writeTreeContract(offSchema, good);
    const badShape = await runContractCheck({ root: offSchema, base: "HEAD" });
    expect(badShape.exitCode).toBe(2);
    expect(all(badShape)).toContain("does not match its schema");

    // The slice is read at the base too: untracking it leaves the working tree
    // whole, so only the base side is missing.
    const untracked = await staged();
    git(untracked, "rm", "-q", "--cached", ".hexagen/slice.json");
    git(untracked, "commit", "-q", "-m", "untrack the slice");
    const noSlice = await runContractCheck({ root: untracked, base: "HEAD" });
    expect(noSlice.exitCode).toBe(2);
    expect(all(noSlice)).toContain("slice.json");
    expect(all(noSlice)).toContain(
      "absent at base because it was never staged",
    );
  });
});
