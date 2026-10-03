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
import { readContractBase } from "../../../src/commands/contract/growth.js";
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

/**
 * Split a command line into shell words: single quotes quote, and an embedded
 * single quote is the `'\''` idiom. Enough of the shell to read back the line
 * `propose --closed` prints, so a test can run the command as printed.
 */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (line.startsWith("'\\''", i)) {
        word += "'";
        i += 3;
      } else if (c === "'") quoted = false;
      else word += c;
      continue;
    }
    if (c === "'") {
      quoted = true;
      started = true;
      continue;
    }
    if (c === " ") {
      if (started) words.push(word);
      word = "";
      started = false;
      continue;
    }
    word += c;
    started = true;
  }
  if (started) words.push(word);
  return words;
}

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

  /** The `add-rule` line the proposal printed. */
  function printedFlags(out: string): string {
    const line = out.split("\n").find((l) => l.includes("contract add-rule"));
    expect(line, out).toBeDefined();
    return line!.trim();
  }

  /**
   * The arguments the printed `add-rule` line passes to `--except`, so a test
   * runs the command as printed instead of re-deriving the list from the JSON.
   *
   * The line is shell-quoted (a repo path may hold a space or a `;`), so the
   * words are read the way a shell reads them: `'…'` quotes and the `'\''`
   * idiom come off, and what the test hands to `add-rule` is what the shell
   * would hand it.
   */
  function printedExceptArgs(out: string): string[] {
    const tokens = shellWords(printedFlags(out)).slice(3);
    const start = tokens.indexOf("--except");
    expect(start, printedFlags(out)).toBeGreaterThanOrEqual(0);
    const rest = tokens.slice(start + 1);
    const end = rest.findIndex((t) => t.startsWith("-"));
    return end === -1 ? rest : rest.slice(0, end);
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
    // Quoted for a shell: the line is meant to be pasted.
    expect(printedFlags(out)).toBe(
      "hexagen contract add-rule --kind closed --except 'lib/c.ts' 'outside/pkg' --yes",
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
    expect(out).toContain('"." — the root package is never inside a prefix');
    expect(out).toContain(
      '"lib/gen/x.ts" — an excludes entry wins over any except',
    );
    expect(printedFlags(out)).not.toContain("--except .");
  });

  it("says the edge list is incomplete, so the rule it proposes is not the whole picture", async () => {
    // Collected, but a language went unread: the crossings listed are the ones
    // the pass could see, and the note says so.
    const root = await setup();
    await writeObserved(root, { unreadLanguages: ["go"] });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    expect(all(r)).toContain("the edge list is incomplete");
    expect(proposedExcepts(all(r))).toEqual([]);
  });

  it("refuses when the edges were not collected, and prints no command", async () => {
    // Nothing is known about the crossings, so "no edge leaves the slice" would
    // be a claim the report cannot make, and an empty rule would be offered as
    // ready to run. This is the same refusal `contract check` makes, so it is
    // exit 2.
    const root = await setup();
    await writeObserved(root, { edgesCollected: false });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("edges were not collected");
    expect(all(r)).toContain("re-run `hexagen observe`");
    expect(r.stdout).toBeUndefined();
    expect(all(r)).not.toContain("contract add-rule");
    expect(all(r)).not.toContain("no observed edge leaves the slice");
  });

  it("quotes a target holding a space or a shell metacharacter", async () => {
    // The line is pasted into a shell: an unquoted `a b.ts` would arrive as two
    // `--except` entries, and an unquoted `;` would run what follows it.
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
        {
          from: "src/a.ts",
          to: "lib/my dir/a;b.ts",
          specifier: "../lib/my dir/a;b",
        },
      ],
    });
    const out = all(await runContractPropose({ root, closed: true }));
    expect(proposedExcepts(out)).toEqual(["lib/c.ts", "lib/my dir/a;b.ts"]);
    expect(printedFlags(out)).toBe(
      "hexagen contract add-rule --kind closed --except 'lib/c.ts' 'lib/my dir/a;b.ts' --yes",
    );
    // Read back the way a shell would: one word per target, no metacharacter run.
    expect(printedExceptArgs(out)).toEqual(["lib/c.ts", "lib/my dir/a;b.ts"]);
  });

  it("escapes an embedded single quote as the shell's '\\'' idiom", async () => {
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "lib/it's/c.ts", specifier: "../lib/it's/c" },
      ],
    });
    const out = all(await runContractPropose({ root, closed: true }));
    expect(printedFlags(out)).toContain("'lib/it'\\''s/c.ts'");
    expect(printedExceptArgs(out)).toEqual(["lib/it's/c.ts"]);
  });

  it("names a directory-spelled target instead of proposing a prefix that widens it", async () => {
    // `observed.json` types `to` as a slice path, so a hand-edited report may
    // spell a package root as a directory. Emitted verbatim, `outside/pkg/` is an
    // except entry that accepts every edge under it; emitted without the slash it
    // is an exact entry that does not match the target as spelled at all. Neither
    // is the one crossing that was observed, so the proposal names the crossing
    // and the exact flag that would accept it.
    const root = await setup();
    await writeObserved(root, {
      edges: [
        {
          from: "src/a.ts",
          to: "outside/pkg/",
          specifier: "@repo/outside-pkg",
        },
        { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
      ],
    });
    const r = await runContractPropose({ root, closed: true });
    expect(r.exitCode).toBe(0);
    const out = all(r);
    expect(proposedExcepts(out)).toEqual(["lib/c.ts"]);
    expect(printedExceptArgs(out)).toEqual(["lib/c.ts"]);
    // Nothing is proposed as a directory prefix: no entry ends in `/`.
    expect(proposedExcepts(out).some((e) => e.endsWith("/"))).toBe(false);
    expect(out).toContain('not proposed: "outside/pkg/"');
    expect(out).toContain("--except outside/pkg/");

    // The rule the proposal writes accepts what it listed and still refuses the
    // crossing it named, which is why it named it rather than guessing: the
    // exact entry `outside/pkg` does not match a target spelled `outside/pkg/`.
    await runContractAddRule({
      root,
      kind: "closed",
      except: printedExceptArgs(out),
      id: "c1",
      yes: true,
    });
    const after = await runContractCheck({ root });
    expect(after.exitCode).toBe(1);
    expect(all(after)).toContain("violation: c1  src/a.ts  @repo/outside-pkg");
  });

  it("keeps the two spellings of one package root apart", async () => {
    const root = await setup();
    await writeObserved(root, {
      edges: [
        { from: "src/a.ts", to: "outside/pkg", specifier: "@repo/outside-pkg" },
        { from: "api/y.ts", to: "outside/pkg/", specifier: "../outside/pkg" },
      ],
    });
    const out = all(await runContractPropose({ root, closed: true }));
    // The exact spelling is proposed as it stands; the directory spelling is
    // never folded into it, which would turn one crossing into a prefix.
    expect(proposedExcepts(out)).toEqual(["outside/pkg"]);
    expect(out).toContain('not proposed: "outside/pkg/"');
  });

  it("the printed flags write a rule that holds, and a crossing it never saw still fails", async () => {
    const root = await setup();
    const edges = [
      { from: "src/a.ts", to: "lib/c.ts", specifier: "../lib/c" },
      { from: "api/y.ts", to: "outside/pkg", specifier: "@repo/outside-pkg" },
      { from: "src/a.ts", to: "src/b.ts", specifier: "./b" },
      // The awkward one travels the whole way: a space and a `;` in a path, in a
      // quoted command, into the rule that is written.
      {
        from: "ui/x.ts",
        to: "lib/my dir/a;b.ts",
        specifier: "../../lib/my dir/a;b",
      },
    ];
    await writeObserved(root, { edges });

    const proposal = all(await runContractPropose({ root, closed: true }));
    const added = await runContractAddRule({
      root,
      kind: "closed",
      except: printedExceptArgs(proposal),
      id: "c1",
      yes: true,
    });
    expect(added.exitCode).toBe(0);
    expect((await readContract(root)).rules[0]).toEqual({
      id: "c1",
      kind: "closed",
      except: ["lib/c.ts", "outside/pkg", "lib/my dir/a;b.ts"],
      severity: "error",
    });
    // Every crossing the proposal listed is now accepted: the gate is green.
    expect((await runContractCheck({ root })).exitCode).toBe(0);

    await writeObserved(root, {
      edges: [
        ...edges,
        { from: "src/a.ts", to: "other/d.ts", specifier: "../other/d" },
      ],
    });
    const after = await runContractCheck({ root });
    expect(after.exitCode).toBe(1);
    expect(all(after)).toContain("violation: c1  src/a.ts  ../other/d");
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

  /**
   * The warning is about one rule's `except` list covering every observed package
   * outside the slice: rules are ANDed, so an edge must pass each of them, and a
   * rule that covers them all is the one rule that would accept any crossing.
   */
  async function withPackages(
    opts: { paths?: string[]; exclude?: string[]; pkgs?: typeof PKGS } = {},
  ): Promise<string> {
    const root = await setup(opts.paths ?? ["src/"], FILES, opts.exclude ?? []);
    await writeObserved(root, { packages: opts.pkgs ?? PKGS });
    return root;
  }

  it("warns when one rule's excepts cover every package outside the slice", async () => {
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
    // It names the packages it judged, one per unit.
    expect(said).toContain("(apps/web, libs/ui, packages/core)");
    expect(said).toContain("accepts every crossing");
    // the contract itself still prints, in full
    expect(r.stdout).toContain('"kind": "closed"');
  });

  it("warns for a sibling of the slice's own package, which shares its top-level directory", async () => {
    // `apps` holds the slice's tree AND two packages outside it. Dropping the
    // whole top-level directory because the slice starts inside it would hide
    // both siblings, so the units are package roots.
    const root = await withPackages({
      paths: ["src/", "apps/web/"],
      pkgs: [
        {
          name: "@repo/web",
          root: "apps/web",
          manifestFile: "apps/web/package.json",
        },
        {
          name: "@repo/admin",
          root: "apps/admin",
          manifestFile: "apps/admin/package.json",
        },
        {
          name: "@repo/api",
          root: "apps/api",
          manifestFile: "apps/api/package.json",
        },
      ],
    });
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps/"],
      id: "c1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).toContain('closed rule "c1"');
    expect(said).toContain("(apps/admin, apps/api)");
  });

  it("an except narrower than a package root does not cover it", async () => {
    // `apps/web/ui/` accepts crossings into that directory only, so a crossing
    // into the rest of `apps/web` still fails: the rule is not wide open.
    const root = await withPackages();
    await runContractAddRule({
      root,
      kind: "closed",
      except: ["apps/web/ui/", "libs/ui", "packages/core"],
      id: "c1",
      yes: true,
    });
    const said = all(await runContractShow({ root }));
    expect(said).not.toContain("every crossing");

    // Widen that one entry to the package root and the rule does cover the repo.
    const wider = await withPackages();
    await runContractAddRule({
      root: wider,
      kind: "closed",
      except: ["apps/web/", "libs/ui", "packages/core"],
      id: "c1",
      yes: true,
    });
    expect(all(await runContractShow({ root: wider }))).toContain(
      "every crossing",
    );
  });

  it("says nothing while one package outside the slice is uncovered", async () => {
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

  it("a bare name is not coverage: an except entry without a trailing / is an exact file", async () => {
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

  it("needs no except for the package the slice occupies or one it excludes", async () => {
    // `apps/web` is the slice's own tree and `packages/core` is denied by an
    // excludes entry, so neither is a crossing an except could accept: only
    // `libs/ui` has to be excepted for the rule to cover the repo.
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
    // It names only the package it judged, not the two it skipped.
    expect(covered).toContain("(libs/ui)");
    expect(covered).not.toContain("apps/web");

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

  it("two rules that between them cover everything do not warn: rules are ANDed", async () => {
    // An edge has to pass EVERY closed rule, so `c1` alone still refuses a
    // crossing into `packages/core` and `c2` alone refuses `apps/`. Together
    // they cover the repo, but neither one does, so the slice is still closed.
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
    expect(said).not.toContain("every crossing");
    expect(said).not.toContain("warning:");
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

  it("the root package is not a unit to cover", async () => {
    // `.` is the whole repo, not a package an except could name, so it must not
    // stand in for one: only the two real packages are judged.
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
    expect(said).toContain("(apps/web, libs/ui)");

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

// ── contract check --base: the growth guard ──────────────────────────────────
//
// Every writer of `.hexagen/` adds it to the repo exclude file, so the guard can
// only read a base when the client staged the sidecar (`workbook export
// --stage`, or `git add -f`). `staged()` does that, which is what makes these
// cases reachable at all.
interface BaseFixture {
  /** A rule is a `Record`: a `closed` rule carries `except`, a list. */
  rules?: Record<string, string | string[]>[];
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

/** A `closed` rule: no from/to, `except` the only crossing it allows. */
const CLOSED_RULE = {
  id: "slice-closed",
  kind: "closed",
  except: ["api/legacy/"],
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
  rules: Record<string, string | string[]>[];
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

async function editTreeSlice(
  root: string,
  over: { id?: string; paths?: string[]; excludes?: string[] },
): Promise<void> {
  const slice = JSON.parse(
    await readFile(path.join(root, ".hexagen", "slice.json"), "utf8"),
  ) as { id: string; paths: string[]; excludes: string[] };
  await put(
    root,
    ".hexagen/slice.json",
    `${JSON.stringify(
      {
        ...slice,
        ...(over.id ? { id: over.id } : {}),
        ...(over.paths ? { paths: over.paths } : {}),
        ...(over.excludes
          ? { excludes: [...slice.excludes, ...over.excludes] }
          : {}),
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Every row of the growth table: what the base holds, how the tree changes it,
 * and the exit `check --base` must give. `exit: 0` rows are the ones a guard
 * that only ever fails would get wrong. `finding` is set where the exit code
 * alone cannot tell two rows apart — the same tree is reachable through a
 * different guard, so only the message says which one fired.
 */
const GROWTH_ROWS: Array<{
  name: string;
  exit: 0 | 1;
  finding?: string;
  base?: BaseFixture;
  weaken: (root: string) => Promise<void>;
}> = [
  {
    name: "a new knownViolations entry",
    exit: 1,
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations.push({ ...ENTRY });
      await writeTreeContract(root, c);
    },
  },
  {
    name: "an expires pushed later",
    exit: 1,
    base: { knownViolations: [{ ...ENTRY, expires: "2026-12-01" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations[0]!.expires = "2027-12-01";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "an expires dropped",
    exit: 1,
    base: { knownViolations: [{ ...ENTRY, expires: "2026-12-01" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.knownViolations = [{ ...ENTRY }];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a removed rule",
    exit: 1,
    base: { rules: [RULE, { ...RULE, id: "no-ui-lib" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules = c.rules.filter((r) => r.id !== "no-ui-lib");
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a severity downgraded to warn",
    exit: 1,
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.severity = "warn";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a rule field edited",
    exit: 1,
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.to = "api/legacy/";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a new slice exclude",
    exit: 1,
    weaken: (root) => editTreeSlice(root, { excludes: ["api/legacy/"] }),
  },
  {
    name: "a slice paths entry removed",
    exit: 1,
    weaken: (root) => editTreeSlice(root, { paths: ["src/", "ui/"] }),
  },
  {
    name: "a slice paths entry narrowed",
    exit: 1,
    weaken: (root) => editTreeSlice(root, { paths: ["src/", "ui/", "ui/ui/"] }),
  },
  {
    name: "a slice paths entry added",
    exit: 0,
    weaken: (root) =>
      editTreeSlice(root, { paths: ["src/", "ui/", "api/", "lib/"] }),
  },
  {
    name: "a baselined entry re-pointed at a directory",
    exit: 1,
    finding: "file changed to src",
    base: { knownViolations: [{ ...ENTRY }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      // The one file becomes a whole directory. The triple is the entry's
      // coverage key, so the guard cannot tell what that now hides -- and a
      // new-entry report would be the wrong cause.
      c.knownViolations[0]!.file = "src";
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule except added",
    exit: 1,
    finding: "except added api/vendor/",
    base: { rules: [CLOSED_RULE] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.except = ["api/legacy/", "api/vendor/"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule except widened to a shorter prefix",
    exit: 1,
    finding: "except widened (api/vendor/ -> api/)",
    base: { rules: [{ ...CLOSED_RULE, except: ["api/vendor/"] }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.except = ["api/"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule except removed",
    exit: 0,
    base: {
      rules: [{ ...CLOSED_RULE, except: ["api/legacy/", "api/vendor/"] }],
    },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.except = ["api/legacy/"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule except narrowed to a longer prefix",
    exit: 0,
    base: { rules: [{ ...CLOSED_RULE, except: ["api/"] }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules[0]!.except = ["api/vendor/"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule changed to a prefix kind",
    exit: 1,
    finding: "kind changed (closed -> forbid)",
    base: { rules: [CLOSED_RULE] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules = [
        { ...RULE, id: "slice-closed" },
        ...c.rules.slice(1),
      ] as TreeContract["rules"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a prefix rule changed to closed",
    exit: 1,
    finding: "kind changed (forbid -> closed)",
    base: { rules: [{ ...RULE, id: "slice-closed" }] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules = [
        { ...CLOSED_RULE },
        ...c.rules.slice(1),
      ] as TreeContract["rules"];
      await writeTreeContract(root, c);
    },
  },
  {
    name: "a closed rule removed",
    exit: 1,
    finding: "rule slice-closed removed",
    base: { rules: [CLOSED_RULE, RULE] },
    weaken: async (root) => {
      const c = await readTreeContract(root);
      c.rules = c.rules.filter((r) => r.id !== "slice-closed");
      await writeTreeContract(root, c);
    },
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

  it("11. a new slice exclude fails as growth, and a removed or narrowed paths entry too", async () => {
    const excluded = await staged();
    await editTreeSlice(excluded, { excludes: ["api/legacy/"] });
    const r = await runContractCheck({ root: excluded, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("api/legacy/");
    expect(all(r)).toContain("exclude");

    // A paths entry removed shrinks the slice: the files under it stop being
    // judged, which is worse than an exclude because nothing is ever reported.
    const removed = await staged();
    await editTreeSlice(removed, { paths: ["src/", "ui/"] });
    const gone = await runContractCheck({ root: removed, base: "HEAD" });
    expect(gone.exitCode).toBe(1);
    expect(all(gone)).toContain("api/ removed");

    const narrowed = await staged();
    await editTreeSlice(narrowed, { paths: ["src/", "ui/", "ui/ui/"] });
    const less = await runContractCheck({ root: narrowed, base: "HEAD" });
    expect(less.exitCode).toBe(1);
    expect(all(less)).toContain("ui/ narrowed");
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
    "14. --base gives $exit for $name, and --allow-growth --reason accepts the growth",
    async ({ name, exit, finding, base, weaken }) => {
      const root = await staged(base);
      await weaken(root);
      const refused = await runContractCheck({ root, base: "HEAD" });
      expect(refused.exitCode, name).toBe(exit);
      if (exit === 0) {
        // Not growth: the guard must say so and change nothing.
        expect(all(refused), name).not.toContain("growth vs");
        return;
      }
      if (finding !== undefined) {
        expect(all(refused), name).toContain(finding);
      }
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

  it("19. a base contract bigger than git's default output buffer is read, not called 'never staged'", async () => {
    const root = await staged();
    // Past execFileSync's default maxBuffer of 1 MiB, which used to surface as a
    // failed `git show` and therefore as "never staged".
    const big: TreeContract = {
      schemaVersion: "1.0.0",
      sliceId: "s1",
      rules: [{ ...RULE, from: `src/${"x".repeat(1_100_000)}`, to: "api/" }],
      knownViolations: [],
    };
    await writeTreeContract(root, big);
    git(root, "add", "-f", ".hexagen/contract.json");
    git(root, "commit", "-q", "-m", "a large contract");
    const small: TreeContract = {
      schemaVersion: "1.0.0",
      sliceId: "s1",
      rules: [RULE],
      knownViolations: [],
    };
    await writeTreeContract(root, small);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).not.toContain("never staged");
    expect(all(r)).toContain("from changed");
  });

  it("20. a base file that exists but cannot be read says so, and is not 'never staged'", async () => {
    const stagedRoot = await staged();
    const hash = git(stagedRoot, "rev-parse", "HEAD");
    // GitReader.show returns null for a failed subprocess as well as for an
    // absent path, so the two are told apart by probing the object first.
    expect(() =>
      readContractBase(stagedRoot, "HEAD", { show: () => null }),
    ).toThrow(`cannot read .hexagen/contract.json at ${hash}`);

    const neverStaged = await staged({ stageContract: false });
    expect(() =>
      readContractBase(neverStaged, "HEAD", { show: () => null }),
    ).toThrow("absent at base because it was never staged");
  });

  it("22. two rules sharing an id are matched by value, so a reorder is not a downgrade", async () => {
    // The schema allows a duplicate id (only `add-rule` refuses one), so a
    // hand-edited contract can hold an error and a warn rule under one id.
    const root = await staged({
      rules: [RULE, { ...RULE, severity: "warn" }],
    });
    const swap = async (): Promise<void> => {
      const c = await readTreeContract(root);
      [c.rules[0], c.rules[1]] = [c.rules[1]!, c.rules[0]!];
      await writeTreeContract(root, c);
    };
    await swap();
    const reordered = await runContractCheck({ root, base: "HEAD" });
    expect(reordered.exitCode).toBe(0);
    expect(all(reordered)).not.toContain("growth vs");

    // The genuine loss is still caught: the error rule became a warn rule.
    const downgraded = await staged({
      rules: [RULE, { ...RULE, severity: "warn" }],
    });
    const c = await readTreeContract(downgraded);
    c.rules = c.rules.map((r) => ({ ...r, severity: "warn" }));
    await writeTreeContract(downgraded, c);
    const r = await runContractCheck({ root: downgraded, base: "HEAD" });
    expect(r.exitCode).toBe(1);
    expect(all(r)).toContain("severity changed (error -> warn)");
  });

  it("21. a base whose contract names another slice exits 2", async () => {
    const root = await staged();
    const consistent: TreeContract = {
      schemaVersion: "1.0.0",
      sliceId: "s1",
      rules: [RULE],
      knownViolations: [],
    };
    // Only the contract moves: the base commit holds a contract for slice
    // "other" beside a slice.json that is still "s1", so the guard would compare
    // one slice's rules against another's excludes and call the difference
    // growth.
    await writeTreeContract(root, { ...consistent, sliceId: "other" });
    git(root, "add", "-f", ".hexagen/contract.json");
    git(root, "commit", "-q", "-m", "an inconsistent base");
    await writeTreeContract(root, consistent);
    const r = await runContractCheck({ root, base: "HEAD" });
    expect(r.exitCode).toBe(2);
    expect(all(r)).toContain("inconsistent base");
    expect(all(r)).toContain("other");
    expect(all(r)).toContain("s1");
  });
});
