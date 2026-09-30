import { describe, expect, test, vi } from "vitest";
import {
  anchorExitCode,
  checkAnchors,
  EXIT_DEAD,
  EXIT_LIVE,
  formatAnchorReport,
  type AnchorDeps,
  type AnchorReport,
} from "../../src/mutate-manifest/lib/anchors.js";

const mutation = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  file: "src/target.ts",
  before: "const gate = true;",
  after: "const gate = false;",
  because: "the guard must red",
  command: ["yarn", "t"],
  verdict: "caught",
  ...over,
});

/** The shape every real manifest carries: a file filter and a `-t` regex. */
const selecting = (
  pattern: string,
  file = "src/__tests__/target.test.ts",
): string[] => ["yarn", "vitest", "run", file, "-t", pattern];

const manifestText = (
  ...mutations: readonly Record<string, unknown>[]
): string => JSON.stringify({ version: 1, lane: "W4", mutations });

/** A fake filesystem: path -> contents, or `{ throws }` to reject with exactly that value. */
const fs = (
  files: Record<string, string | { throws: unknown }>,
  over: Partial<AnchorDeps> = {},
): AnchorDeps => {
  let clock = 0;
  return {
    readText: async (path) => {
      const value = files[path];
      if (value === undefined)
        throw new Error(`ENOENT: no such file, open '${path}'`);
      if (typeof value !== "string") throw value.throws;
      return value;
    },
    listTests: async () => {
      throw new Error("no listing was expected");
    },
    now: () => (clock += 50),
    ...over,
  };
};

/**
 * A listing where the FILE registers a test but the PATTERN selects none of it —
 * a genuinely dead pattern. The two listings have to be answered separately:
 * `checkAnchors` asks again without `-t` precisely so that "the pattern picks
 * nothing" and "this file registers nothing here" stop being the same answer. A
 * stub returning `[]` to both says the latter, which is a different finding.
 */
const selectsNothing = async (
  command: readonly string[],
): Promise<readonly string[]> =>
  command.includes("-t")
    ? []
    : ["src/__tests__/target.test.ts > the editor > a case"];

const EMPTY: Omit<
  AnchorReport,
  "faults" | "manifests" | "mutations" | "retired"
> = {
  patterns: 0,
  proved: 0,
  confirmed: 0,
  confirmMs: 0,
};

describe("checkAnchors", () => {
  test("passes an anchor that still appears exactly once", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": "const gate = true;\n",
      }),
    );
    expect(report).toEqual({
      manifests: 1,
      mutations: 1,
      retired: 0,
      faults: [],
      ...EMPTY,
    });
  });

  test("fails an anchor whose text is gone, and says the mutation can never replay", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": "const gate = TRUE;\n",
      }),
    );
    expect(report.faults).toEqual([
      {
        kind: "not-exactly-once",
        manifest: "m.json",
        index: 0,
        mutation: expect.anything(),
        occurrences: 0,
      },
    ]);
    expect(formatAnchorReport(report)).toContain("can never replay again");
  });

  test("fails an AMBIGUOUS anchor too — Rule 2 refuses two occurrences as firmly as none", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": "const gate = true;\nconst gate = true;\n",
      }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "not-exactly-once",
      occurrences: 2,
    });
  });

  test("reports a file that is gone as its own fault, not as a missing anchor", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({ "m.json": manifestText(mutation()) }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "missing-file",
      manifest: "m.json",
      index: 0,
    });
    expect(formatAnchorReport(report)).toContain("FILE GONE  m.json#0");
  });

  test("carries a non-Error rejection through rather than losing what happened", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": { throws: "EACCES" },
      }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "missing-file",
      detail: "EACCES",
    });
  });

  test("skips a retired mutation and counts it, rather than hunting for text it admits is gone", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation({
            retired: "the subject was deleted when its module was removed",
          }),
        ),
      }),
    );
    expect(report).toEqual({
      manifests: 1,
      mutations: 1,
      retired: 1,
      faults: [],
      ...EMPTY,
    });
    expect(formatAnchorReport(report)).toContain("0 live, 1 retired");
  });

  test("reads each source file once however many manifests anchor into it", async () => {
    const readText = vi.fn(async (path: string) =>
      path.endsWith(".json")
        ? manifestText(mutation())
        : "const gate = true;\n",
    );
    await checkAnchors(["a.json", "b.json", "c.json"], fs({}, { readText }));
    expect(
      readText.mock.calls.filter(([p]) => p === "src/target.ts"),
    ).toHaveLength(1);
  });

  test("a manifest it cannot read is a fault, never a skip", async () => {
    const report = await checkAnchors(["gone.json"], fs({}));
    expect(report.faults[0]).toMatchObject({
      kind: "unreadable",
      manifest: "gone.json",
    });
    expect(anchorExitCode(report)).toBe(EXIT_DEAD);
  });

  test("carries a non-Error rejection from a manifest read through as well", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({ "m.json": { throws: "EPERM" } }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "unreadable",
      detail: "EPERM",
    });
  });

  test("a malformed manifest FAILS the check — including an unexplained retirement", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({ "m.json": manifestText(mutation({ retired: true })) }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "malformed",
      manifest: "m.json",
    });
    expect(report.faults[0]).toMatchObject({
      detail: expect.stringContaining("non-empty reason"),
    });
    expect(anchorExitCode(report)).toBe(EXIT_DEAD);
  });

  test("keeps checking the manifests after one it could not parse", async () => {
    const report = await checkAnchors(
      ["bad.json", "good.json"],
      fs({
        "bad.json": "{oops",
        "good.json": manifestText(mutation()),
        "src/target.ts": "const gate = TRUE;\n",
      }),
    );
    expect(report.faults.map((f) => f.kind)).toEqual([
      "malformed",
      "not-exactly-once",
    ]);
  });
});

/**
 * The second address. `-t` is a regex, and one that matches nothing skips every
 * test and exits 0 — which `mutate:verify` reads as `survived`. These are the
 * cases that separate "the pattern still selects its test" from "the pattern
 * selects nothing and nobody can tell".
 */
describe("checkAnchors — the -t pattern", () => {
  const source = "const gate = true;\n";
  const suite = `describe("the editor", () => { test("keeps a draft", () => {}); });`;

  test("proves a live pattern from syntax alone, with no listing spawned at all", async () => {
    const listTests = vi.fn(async () => []);
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(
            mutation({ command: selecting("keeps a draft") }),
          ),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        { listTests },
      ),
    );
    expect(report.faults).toEqual([]);
    expect(report).toMatchObject({
      patterns: 1,
      proved: 1,
      confirmed: 0,
      confirmMs: 0,
    });
    expect(listTests).not.toHaveBeenCalled();
  });

  test("matches the full name — the describe titles and the test title, joined by a space", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation({ command: selecting("the editor keeps a draft") }),
        ),
        "src/target.ts": source,
        "src/__tests__/target.test.ts": suite,
      }),
    );
    expect(report).toMatchObject({ proved: 1, faults: [] });
  });

  test("asks vitest when syntax cannot prove it, and passes on a listing that finds a test", async () => {
    const listTests = vi.fn(async () => [
      "the editor > a case",
      "the editor > another",
    ]);
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(mutation({ command: selecting("a case") })),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": `test.each(rows)("%s case", () => {});`,
        },
        { listTests },
      ),
    );
    expect(report).toMatchObject({
      patterns: 1,
      proved: 0,
      confirmed: 1,
      faults: [],
    });
    expect(listTests).toHaveBeenCalledWith([
      "yarn",
      "vitest",
      "list",
      "src/__tests__/target.test.ts",
      "-t",
      "a case",
    ]);
  });

  test("FAILS a pattern vitest lists no test for — the silent 'survived' this exists to stop", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(
            mutation({ command: selecting("renamed away") }),
          ),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        { listTests: selectsNothing },
      ),
    );
    expect(report.faults).toEqual([
      {
        kind: "dead-pattern",
        manifest: "m.json",
        index: 0,
        mutation: expect.anything(),
        pattern: "renamed away",
      },
    ]);
    const text = formatAnchorReport(report);
    expect(text).toContain("DEAD -t PATTERN  m.json#0");
    expect(text).toContain("selects NO test");
    expect(text).toContain(`would read this mutation as "survived"`);
    expect(anchorExitCode(report)).toBe(EXIT_DEAD);
  });

  test("catches the real incident: a title's parentheses pasted in are a capture group", async () => {
    // The title carries a literal `(Q12)`; the pattern carries it unescaped, so
    // the regex asks for `times Q12` and the name says `times (Q12)`.
    const title =
      "a single motion-kind toggle commits the editor at most twice, not three times (Q12)";
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(mutation({ command: selecting(title) })),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": `test(${JSON.stringify(title)}, () => {});`,
        },
        { listTests: selectsNothing },
      ),
    );
    expect(report).toMatchObject({ proved: 0, confirmed: 1 });
    expect(report.faults[0]).toMatchObject({
      kind: "dead-pattern",
      pattern: title,
    });
  });

  test("an escaped `\\(Q12\\)` selects that same title and passes by syntax", async () => {
    const title = "commits at most twice (Q12)";
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation({ command: selecting("at most twice \\(Q12\\)") }),
        ),
        "src/target.ts": source,
        "src/__tests__/target.test.ts": `test(${JSON.stringify(title)}, () => {});`,
      }),
    );
    expect(report).toMatchObject({ proved: 1, faults: [] });
  });

  test("a -t that is not a valid regex is a fault, not a pattern anyone can run", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation({ command: selecting("unbalanced (") }),
        ),
        "src/target.ts": source,
      }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "bad-pattern",
      pattern: "unbalanced (",
    });
    expect(formatAnchorReport(report)).toContain(
      "UNUSABLE -t PATTERN  m.json#0",
    );
    expect(report).toMatchObject({ patterns: 1, proved: 0, confirmed: 0 });
  });

  test("never proves an ANCHORED pattern by syntax — a missed suite wrapper would fool `^`", async () => {
    const listTests = vi.fn(async () => ["the editor > keeps a draft"]);
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(
            mutation({ command: selecting("^the editor keeps a draft") }),
          ),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        { listTests },
      ),
    );
    expect(report).toMatchObject({ proved: 0, confirmed: 1, faults: [] });
  });

  test("a command that is not `vitest run` cannot be collected, and says so", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation({ command: ["./script.sh", "-t", "a case"] }),
        ),
        "src/target.ts": source,
      }),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "unlistable",
      pattern: "a case",
    });
    const text = formatAnchorReport(report);
    expect(text).toContain("UNCHECKABLE COMMAND  m.json#0");
    expect(text).toContain("cannot be collected");
  });

  test("a listing that could not run is a fault, never a pass — and its cost is still counted", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(mutation({ command: selecting("a case") })),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        {
          listTests: async () => {
            throw new Error("vitest: ENOENT");
          },
        },
      ),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "unlistable",
      detail: "vitest: ENOENT",
    });
    expect(report).toMatchObject({ confirmed: 0, confirmMs: 50 });
  });

  test("names a non-Error listing failure rather than printing [object Object]", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(mutation({ command: selecting("a case") })),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        {
          listTests: async () => {
            throw "SIGKILL";
          },
        },
      ),
    );
    expect(report.faults[0]).toMatchObject({
      kind: "unlistable",
      detail: "SIGKILL",
    });
  });

  test("a test file it cannot read proves nothing, so the entry goes to vitest", async () => {
    const listTests = vi.fn(async () => ["a case"]);
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(mutation({ command: selecting("a case") })),
          "src/target.ts": source,
        },
        { listTests },
      ),
    );
    expect(report).toMatchObject({ confirmed: 1, faults: [] });
    expect(listTests).toHaveBeenCalledOnce();
  });

  test("parses each test file once however many patterns point into it", async () => {
    const readText = vi.fn(async (path: string) => {
      if (path.endsWith(".json"))
        return manifestText(
          mutation({ command: selecting("keeps a draft") }),
          mutation({ command: selecting("the editor") }),
        );
      return path.endsWith(".test.ts") ? suite : source;
    });
    const report = await checkAnchors(
      ["a.json", "b.json"],
      fs({}, { readText }),
    );
    expect(report).toMatchObject({ patterns: 4, proved: 4 });
    expect(
      readText.mock.calls.filter(([p]) => p.endsWith(".test.ts")),
    ).toHaveLength(1);
  });

  test("adds up the time the listings took, so their cost stays in the report", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs(
        {
          "m.json": manifestText(
            mutation({ command: selecting("a case") }),
            mutation({ command: selecting("another") }),
          ),
          "src/target.ts": source,
          "src/__tests__/target.test.ts": suite,
        },
        { listTests: async () => ["a case"] },
      ),
    );
    expect(report).toMatchObject({ confirmed: 2, confirmMs: 100 });
    expect(formatAnchorReport(report)).toContain(
      "2 confirmed by vitest list in 100ms",
    );
  });
});

describe("formatAnchorReport", () => {
  test("says plainly when every live anchor resolves", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": "const gate = true;\n",
      }),
    );
    expect(formatAnchorReport(report)).toBe(
      "anchors: 1 manifest(s), 1 mutation(s): 1 live, 0 retired. 0 -t pattern(s): 0 proved by " +
        "syntax, 0 confirmed by vitest list in 0ms. Every live anchor resolves exactly once and " +
        "every -t pattern selects a test.",
    );
  });

  test("names the manifest, the 0-based index, the file and the claim at stake", async () => {
    const report = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(
          mutation(),
          mutation({ before: "const other = 1;" }),
        ),
        "src/target.ts": "const gate = true;\n",
      }),
    );
    const text = formatAnchorReport(report);
    expect(text).toContain("DEAD ANCHOR  m.json#1");
    expect(text).toContain("file: src/target.ts");
    expect(text).toContain("because: the guard must red");
    expect(text).toContain("1 fault(s)");
    expect(text).toContain("retire it with a reason if the code is gone");
    expect(text).toContain("verify it selects before writing it");
  });

  test("prints the detail of a manifest it could not parse", () => {
    expect(
      formatAnchorReport({
        manifests: 1,
        mutations: 0,
        retired: 0,
        ...EMPTY,
        faults: [
          {
            kind: "malformed",
            manifest: "m.json",
            detail: "version must be 1",
          },
        ],
      }),
    ).toContain("MALFORMED MANIFEST  m.json\n  version must be 1");
  });

  test("prints the detail of a manifest it could not read", () => {
    expect(
      formatAnchorReport({
        manifests: 1,
        mutations: 0,
        retired: 0,
        ...EMPTY,
        faults: [{ kind: "unreadable", manifest: "m.json", detail: "EACCES" }],
      }),
    ).toContain("UNREADABLE MANIFEST  m.json\n  EACCES");
  });
});

describe("anchorExitCode", () => {
  test("is zero only when nothing is dead", async () => {
    const live = await checkAnchors(
      ["m.json"],
      fs({
        "m.json": manifestText(mutation()),
        "src/target.ts": "const gate = true;\n",
      }),
    );
    expect(anchorExitCode(live)).toBe(EXIT_LIVE);
  });
});
