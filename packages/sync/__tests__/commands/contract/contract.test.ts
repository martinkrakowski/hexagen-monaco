import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  contractCommander,
  runContractAddRule,
  runContractCheck,
  runContractPropose,
  runContractShow,
  type AddRuleOptions,
} from "../../../src/commands/contract/index.js";
import { isSuppressionExpired } from "../../../src/commands/contract/evaluate.js";
import {
  runSliceCheck,
  runSliceInit,
} from "../../../src/commands/slice/index.js";
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
  exclude: string[] = [],
): Promise<string> {
  const root = await makeRepo(files);
  await runSliceInit({ root, paths, exclude, id: "s1", yes: true });
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

describe("contract propose --closed", () => {
  /** The `except` list the proposal printed, parsed from its JSON line. */
  function proposedExcepts(out: string): string[] {
    const line = out.split("\n").find((l) => l.startsWith("except: "));
    expect(line, out).toBeDefined();
    return JSON.parse(line!.slice("except: ".length)) as string[];
  }

  /** The `--except` flags of the `add-rule` line the proposal printed. */
  function printedFlags(out: string): string {
    const line = out.split("\n").find((l) => l.includes("contract add-rule"));
    expect(line, out).toBeDefined();
    return line!.trim();
  }

  it("emits one closed rule excepting every crossing, and writes nothing", async () => {
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
        { from: "ui/x.ts", to: "lib/c.ts", specifier: "../../lib/c" },
        { from: "api/y.ts", to: "outside/pkg", specifier: "@repo/outside-pkg" },
        { from: "src/a.ts", to: "src/b.ts", specifier: "./b" },
        { from: "lib/c.ts", to: "src/a.ts", specifier: "../src/a" },
        { from: "ui/x.ts", to: "api/y.ts", specifier: "../api/y" },
        { from: "other/d.go", to: "outside/o.ts", specifier: "../outside/o" },
      ],
    });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    const out = all(r);
    // Each crossing target exactly as `slice check` prints it: the file path for
    // a file target, the package root for a package root, deduplicated, and
    // never a bare directory name (`lib` would match no target at all, since an
    // except entry without a trailing `/` is an exact file).
    expect(proposedExcepts(out)).toEqual(["lib/c.ts", "outside/pkg"]);
    expect(printedFlags(out)).toBe(
      "hexagen contract add-rule --kind closed --except lib/c.ts outside/pkg --yes",
    );
    // The crossing that stays inside the slice is not proposed, and neither is
    // the one entering it or the one between two paths outside it: none of them
    // leaves the slice.
    expect(out).not.toContain("src/b.ts");
    await expect(readContract(root)).rejects.toThrow();
  });

  it("proposes no excepts when no edge leaves the slice", async () => {
    const root = await setup();
    await writeObserved(root, {
      edges: [{ from: "src/a.ts", to: "src/b.ts", specifier: "./b" }],
    });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    const out = all(r);
    expect(proposedExcepts(out)).toEqual([]);
    expect(printedFlags(out)).toBe(
      "hexagen contract add-rule --kind closed --except --yes",
    );
    expect(out).toContain("no observed edge leaves the slice");
    await expect(readContract(root)).rejects.toThrow();
  });

  it("reports the crossings no except can accept instead of proposing them", async () => {
    // `.` is never inside a prefix, and an excludes entry beats any except, so
    // neither can be an except entry: proposing one would name a rule that
    // cannot pass.
    const root = await setup(["src/"], FILES, ["lib/gen/"]);
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: ".", specifier: "root-pkg" },
        { from: "src/a.ts", to: "lib/gen/x.ts", specifier: "../lib/gen/x" },
        { from: "src/a.ts", to: "outside/o.ts", specifier: "../outside/o" },
      ],
    });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    const out = all(r);
    expect(proposedExcepts(out)).toEqual(["outside/o.ts"]);
    expect(out).toContain('"." (the root package is never inside a prefix)');
    expect(out).toContain(
      '"lib/gen/x.ts" (an excludes entry wins over any except)',
    );
    expect(printedFlags(out)).not.toContain("--except .");
  });

  it("says the edge list is incomplete, so the rule it proposes is not the whole picture", async () => {
    const root = await setup();
    await writeObserved(root, { edgesCollected: false });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("the edge list is incomplete");
    expect(proposedExcepts(all(r))).toEqual([]);
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

  it("adds a closed rule with its except list and no from/to", async () => {
    const root = await setup();
    const r = await runContractAddRule({
      root,
      kind: "closed",
      except: ["lib/", "outside"],
      id: "closed-slice",
      yes: true,
    });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("added rule closed-slice");
    expect((await readContract(root)).rules).toEqual([
      {
        id: "closed-slice",
        kind: "closed",
        except: ["lib/", "outside"],
        severity: "error",
      },
    ]);
  });

  it("a closed rule may be given --except with no prefixes at all", async () => {
    const root = await setup();
    const r = await runContractAddRule({
      root,
      kind: "closed",
      except: [],
      id: "c",
      yes: true,
    });
    expect(r.exitCode).toBe(0);
    expect((await readContract(root)).rules[0]).toEqual({
      id: "c",
      kind: "closed",
      except: [],
      severity: "error",
    });
  });

  it("each kind takes only its own flags, and names the wrong one", async () => {
    const root = await setup();
    // Each case carries its whole flag set: nothing is inherited.
    const cases: Array<[string, Omit<AddRuleOptions, "root">, string]> = [
      [
        "closed with --from",
        { kind: "closed", except: [], from: "ui/" },
        "takes no --from",
      ],
      [
        "closed with --to",
        { kind: "closed", except: [], to: "api/" },
        "takes no --to",
      ],
      ["closed without --except", { kind: "closed" }, "needs --except"],
      [
        "forbid with --except",
        { kind: "forbid", from: "ui/", to: "api/", except: ["lib/"] },
        "takes no --except",
      ],
      [
        "allow-only with --except",
        { kind: "allow-only", from: "ui/", to: "api/", except: ["lib/"] },
        "takes no --except",
      ],
      ["forbid without --from", { kind: "forbid", to: "api/" }, "needs --from"],
      ["forbid without --to", { kind: "forbid", from: "ui/" }, "needs --to"],
      [
        "allow-only without --from",
        { kind: "allow-only", to: "api/" },
        "needs --from",
      ],
      [
        "allow-only without --to",
        { kind: "allow-only", from: "ui/" },
        "needs --to",
      ],
      [
        "a bad --except entry",
        { kind: "closed", except: ["../x/"] },
        '--except "../x/"',
      ],
      [
        "an unknown kind",
        { kind: "deny" as never, from: "ui/", to: "api/" },
        "--kind must be",
      ],
    ];
    for (const [label, flags, message] of cases) {
      const r = await runContractAddRule({ ...flags, root, yes: true });
      expect(r.exitCode, label).toBe(2);
      expect(all(r), label).toContain(message);
    }
    await expect(readContract(root)).rejects.toThrow();
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

describe("contract show: a closed rule that accepts every crossing", () => {
  /** The package roots `observe` would have found for a three-package repo. */
  const PKGS = [
    {
      name: "@repo/web",
      root: "apps/web",
      manifestFile: "apps/web/package.json",
    },
    { name: "@repo/ui", root: "libs/ui", manifestFile: "libs/ui/package.json" },
    {
      name: "@repo/core",
      root: "packages/core",
      manifestFile: "packages/core/package.json",
    },
  ];

  /** A repo whose slice is `src/`, with the three packages observed. */
  async function withPackages(
    opts: { paths?: string[]; exclude?: string[]; pkgs?: typeof PKGS } = {},
  ): Promise<string> {
    const root = await setup(opts.paths ?? ["src/"], FILES, opts.exclude ?? []);
    await writeObserved(root, { packages: opts.pkgs ?? PKGS });
    return root;
  }

  it("warns when the excepts cover every top-level directory outside the slice", async () => {
    const root = await withPackages();
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps/", "libs/", "packages/"],
      id: "c1",
      yes: true,
    });
    const r = await runContractShow({ root });
    expect(r.exitCode).toBe(0);
    const said = all(r);
    expect(said).toContain("warning:");
    expect(said).toContain('closed rule "c1"');
    expect(said).toContain("apps/, libs/, packages/");
    expect(said).toContain("accepts every crossing");
    // the contract itself still prints, in full
    expect(r.stdout).toContain('"kind": "closed"');
  });

  it("says nothing while one top-level directory is uncovered", async () => {
    const root = await withPackages();
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps/", "libs/"],
      id: "c1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).not.toContain("warning:");
    expect(said).not.toContain("every crossing");
  });

  it("a bare directory name is not coverage: an except entry is an exact file without a trailing /", async () => {
    const root = await withPackages();
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps", "libs", "packages"],
      id: "c1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).not.toContain("every crossing");
  });

  it("needs no except for a directory the slice occupies or one it excludes", async () => {
    // `apps` holds the slice's own tree and `packages` is denied by an
    // excludes entry, so neither is a crossing an except could accept: only
    // `libs` has to be excepted for the rule to cover the repo.
    const root = await withPackages({
      paths: ["src/", "apps/web/"],
      exclude: ["packages/"],
    });
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["libs/"],
      id: "c1",
      yes: true,
    });
    const covered = all(await runContractShow({ root }));
    expect(covered).toContain('closed rule "c1"');
    expect(covered).toContain("accepts every crossing");
    // It names only the directory it judged, not the two it skipped.
    expect(covered).toContain("(libs/)");
    expect(covered).not.toContain("apps/");

    // Drop that one except and the warning goes with it.
    const root2 = await withPackages({
      paths: ["src/", "apps/web/"],
      exclude: ["packages/"],
    });
    await runContractAddRule({
      root: root2,
      kind: "closed",
      except: [],
      id: "c1",
      yes: true,
    });
    const uncovered = all(await runContractShow({ root: root2 }));
    expect(uncovered).not.toContain("every crossing");
  });

  it("adds the coverage of two closed rules before warning", async () => {
    const root = await withPackages();
    for (const [id, except] of [
      ["c1", ["apps/", "libs/"]],
      ["c2", ["packages/"]],
    ] as const) {
      await runContractAddRule({
        root,
        kind: "closed",
        except: [...except],
        id,
        yes: true,
      });
    }
    const said = all(await runContractShow({ root }));
    expect(said).toContain('closed rules "c1", "c2"');
    expect(said).toContain("accept every crossing");
  });

  it("has nothing to say when the repo lists no package", async () => {
    const empty = await withPackages({ pkgs: [] });
    await runContractAddRule({
      root: empty,
      kind: "closed",
      except: [],
      id: "c1",
      yes: true,
    });
    expect(all(await runContractShow({ root: empty }))).not.toContain(
      "every crossing",
    );
  });

  it("the root package is not a directory to cover", async () => {
    // `.` is the whole repo, not a directory the excepts could name, so it must
    // not stand in for one: only the two real directories are judged.
    const root = await withPackages({
      pkgs: [
        { name: "root", root: ".", manifestFile: "package.json" },
        ...PKGS.slice(0, 2),
      ],
    });
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps/", "libs/"],
      id: "c1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).toContain("accepts every crossing");
    expect(said).toContain("(apps/, libs/)");

    const rootOnly = await withPackages({
      pkgs: [{ name: "root", root: ".", manifestFile: "package.json" }],
    });
    await runContractAddRule({
      root: rootOnly,
      kind: "closed",
      except: [],
      id: "c1",
      yes: true,
    });
    expect(all(await runContractShow({ root: rootOnly }))).not.toContain(
      "every crossing",
    );
  });

  it("skips the check with a note when observed.json was never staged", async () => {
    // `show` prints the contract whether or not a scan has been staged, so the
    // warning is best-effort: the note says the check did not run.
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "closed",
      except: [],
      id: "c1",
      yes: true,
    });
    const r = await runContractShow({ root });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"id": "c1"');
    const said = all(r);
    expect(said).toContain("note:");
    expect(said).toContain("observed.json");
    expect(said).not.toContain("every crossing");
  });

  it("needs no coverage check for a contract without a closed rule", async () => {
    const root = await setup();
    await runContractAddRule({
      root,
      kind: "forbid",
      from: "ui/",
      to: "api/",
      id: "r1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).not.toContain("note:");
    expect(said).not.toContain("every crossing");
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

describe("contract check: the closed kind", () => {
  /** A contract written by hand, as a client repo would stage it. */
  const withContract = (root: string, rules: unknown[]): Promise<void> =>
    put(
      root,
      ".hexagen/contract.json",
      JSON.stringify({
        schemaVersion: "1.0.0",
        sliceId: "s1",
        rules,
        knownViolations: [],
      }),
    );

  async function withClosedRule(except: string[]): Promise<string> {
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
        { from: "src/a.ts", to: "src/b.ts", specifier: "./b" },
      ],
    });
    await withContract(root, [
      { id: "c1", kind: "closed", except, severity: "error" },
    ]);
    return root;
  }

  it("fails on every outward edge when the except list is empty", async () => {
    const root = await withClosedRule([]);
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("violation: c1  src/a.ts  ../lib/c");
    expect(all(r)).not.toContain("src/b.ts");
  });

  it("passes once the target's prefix is excepted", async () => {
    const root = await withClosedRule(["lib/"]);
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  it("baselines the violation and keeps the rule free of from/to", async () => {
    const root = await withClosedRule([]);
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(0);
    const c = await readContract(root);
    expect(c.knownViolations[0]).toMatchObject({
      rule: "c1",
      file: "src/a.ts",
      specifier: "../lib/c",
    });
    expect(c.rules).toEqual([
      { id: "c1", kind: "closed", except: [], severity: "error" },
    ]);
    expect((await runContractCheck({ root })).exitCode).toBe(0);
  });

  /** Rewrite the baseline entry's expiry, as a client would edit the file. */
  async function withExpiry(root: string, expires: string): Promise<void> {
    const c = await readContract(root);
    c.knownViolations[0]!.expires = expires;
    await put(root, ".hexagen/contract.json", JSON.stringify(c));
  }

  it("a baselined violation stays hidden through its expires day and returns after it", async () => {
    const root = await withClosedRule([]);
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(0);
    expect((await readContract(root)).knownViolations).toEqual([
      { rule: "c1", file: "src/a.ts", specifier: "../lib/c" },
    ]);
    await withExpiry(root, new Date().toISOString().slice(0, 10));
    expect((await runContractCheck({ root })).exitCode).toBe(0);
    await withExpiry(root, "2020-01-01");
    const after = await runContractCheck({ root });
    expect(after.exitCode).toBe(1);
    expect(all(after)).toContain("violation: c1  src/a.ts  ../lib/c");
  });

  it("edges that were not collected can never be clean, and never blame the rule", async () => {
    // `edgesComplete` is false, so nothing can be said about the crossings the
    // rule would judge: the gate says so instead of naming the rule.
    const root = await setup();
    await writeObserved(root, { edgesCollected: false });
    await withContract(root, [
      { id: "c1", kind: "closed", except: [], severity: "error" },
    ]);
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("incomplete");
    expect(all(r)).not.toContain("c1");
    expect(
      (await runContractCheck({ root, baseline: true, yes: true })).exitCode,
    ).toBe(2);
  });

  it("an unresolved import fails under the built-in rule, never under the closed rule", async () => {
    // Excepts cannot silence an unresolved row: it is not an edge.
    const root = await setup();
    await writeObserved(root, {
      unresolved: [
        { from: "src/a.ts", specifier: "lodash", reason: "not-found" },
      ],
    });
    await withContract(root, [
      {
        id: "c1",
        kind: "closed",
        except: ["lib/", "outside/"],
        severity: "error",
      },
    ]);
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("violation: unresolved-import  src/a.ts  lodash");
    expect(all(r)).not.toContain("c1");
  });
});

describe("contract check: no contract.json (the plan 3 precondition)", () => {
  it("is clean with no rule in force, so a client that never staged one has a green gate", async () => {
    // Plan 3 §2: `loadContract` returns undefined when the file is absent and no
    // rule is evaluated, so an outward edge passes unjudged. `slice check
    // --closed` sees the same edge and fails: the gap the plan leaves visible
    // (plan 5 owns the CI recipe that makes the absence exit 2).
    const root = await setup();
    await writeObserved(root, {
      edges: [{ from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" }],
    });
    const r = await runContractCheck({ root });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("clean");
    const drift = await runSliceCheck({ root, closed: true });
    expect(drift.exitCode).toBe(1);
    expect(all(drift)).toContain("leaves: src/a.ts -> lib/c.ts");
    await expect(readContract(root)).rejects.toThrow();
  });
});

describe("contract add-rule: what commander collects for --except", () => {
  interface Parsed {
    code: number | string | null | undefined;
    said: string;
    root: string;
  }

  /** A repo with a slice `src/` and a staged crossing to `lib/c.ts`. */
  async function repoWithCrossing(): Promise<string> {
    const root = await makeRepo();
    await runSliceInit({ root, paths: ["src/"], id: "s1", yes: true });
    await writeObserved(root, {
      edges: [{ from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" }],
    });
    return root;
  }

  /**
   * Parses a real command in `root`, so the pin is on commander itself rather
   * than on `runContractAddRule` (which skips the parser). Returns the exit code
   * the command emitted and the messages it printed.
   */
  async function runCommand(args: string[], root: string): Promise<Parsed> {
    const before = process.exitCode;
    const said: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...line) => {
      said.push(line.map(String).join(" "));
    });
    try {
      await contractCommander.parseAsync([...args, "--root", root], {
        from: "user",
      });
      return { code: process.exitCode, said: said.join("\n"), root };
    } finally {
      process.exitCode = before;
      spy.mockRestore();
    }
  }

  /** `add-rule` with `--yes`, so the parser is exercised on a writing path. */
  async function parse(args: string[]): Promise<Parsed> {
    const root = await makeRepo();
    await runSliceInit({ root, paths: ["src/"], id: "s1", yes: true });
    return runCommand(["add-rule", ...args, "--yes"], root);
  }

  const exceptOf = async (args: string[]): Promise<unknown> => {
    const { root } = await parse(args);
    const c = await readContract(root);
    return (c.rules[0] as { except: unknown }).except;
  };

  it("a bare second occurrence keeps the prefixes already collected", async () => {
    // commander fills an optional-value option given without one with `true`,
    // which used to replace the collected list and silently drop the crossing.
    expect(
      await exceptOf(["--kind", "closed", "--except", "lib/", "--except"]),
    ).toEqual(["lib/"]);
  });

  it("a bare occurrence on its own collects nothing, which is a legal rule", async () => {
    expect(await exceptOf(["--kind", "closed", "--except"])).toEqual([]);
  });

  it("one occurrence collects every following prefix", async () => {
    expect(await exceptOf(["--kind", "closed", "--except", "a", "b"])).toEqual([
      "a",
      "b",
    ]);
  });

  it("two occurrences collect both lists", async () => {
    expect(
      await exceptOf([
        "--kind",
        "closed",
        "--except",
        "lib/",
        "--except",
        "b/",
      ]),
    ).toEqual(["lib/", "b/"]);
  });

  it("an entry that is not a slice path is refused with exit 2", async () => {
    const { code, said } = await parse(["--kind", "closed", "--except", ""]);
    expect(code).toBe(2);
    expect(said).toContain('--except ""');
  });

  it("propose --closed writes nothing at all", async () => {
    // `propose` takes no write flag, so there is no `--yes` that could make it
    // write: the candidate stays on stdout either way.
    const root = await repoWithCrossing();
    const { code } = await runCommand(["propose", "--closed"], root);
    expect(code).toBe(0);
    expect(existsSync(path.join(root, ".hexagen", "contract.json"))).toBe(
      false,
    );
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
