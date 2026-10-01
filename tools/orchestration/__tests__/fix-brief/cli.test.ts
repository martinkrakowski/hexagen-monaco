import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runFixBrief, type FixBriefIo } from "../../src/fix-brief/cli.js";
import { exclusiveWriter, pathExists } from "../../src/fix-brief/files.js";
import { REPO } from "../sweep/support.js";

const ARGV = [
  "--pr",
  "12",
  "--round",
  "2",
  "--lane",
  "L1",
  "--worktree",
  "/w/l1",
  "--branch",
  "feat/x",
  "--tip",
  "abc1234",
];

interface Node {
  id: string;
  isResolved: boolean;
  body?: string;
}

function ghPages(pages: readonly (readonly Node[])[]) {
  const calls: string[][] = [];
  const gh = async (args: readonly string[]): Promise<string> => {
    calls.push([...args]);
    const after = args.find((a) => a.startsWith("after="));
    const index = after === undefined ? 0 : Number(after.slice(6));
    const nodes = pages[index] ?? [];
    return JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            id: "PR_1",
            reviewThreads: {
              pageInfo: {
                hasNextPage: index < pages.length - 1,
                endCursor: String(index + 1),
              },
              nodes: nodes.map((n) => ({
                id: n.id,
                isResolved: n.isResolved,
                path: "src/a.ts",
                line: 3,
                originalLine: 3,
                isOutdated: false,
                comments: {
                  nodes: [{ author: { login: "bot" }, body: n.body ?? "text" }],
                },
              })),
            },
          },
        },
      },
    });
  };
  return { gh, calls };
}

function harness(over: Partial<FixBriefIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { path: string; text: string }[] = [];
  const io: FixBriefIo = {
    argv: ARGV,
    repo: REPO,
    gh: async () => {
      throw new Error("no forge call expected");
    },
    log: (t) => out.push(t),
    logError: (t) => err.push(t),
    exists: async () => false,
    writeExclusive: async (path, text) => {
      writes.push({ path, text });
    },
    ...over,
  };
  return { io, out, err, writes };
}

describe("fix-brief — the command", () => {
  test("only UNRESOLVED threads become items, across every page, and the brief goes to stdout", async () => {
    const { gh } = ghPages([
      [
        { id: "PRRT_a", isResolved: false, body: "first" },
        { id: "PRRT_done", isResolved: true, body: "closed" },
      ],
      [{ id: "PRRT_b", isResolved: false, body: "second" }],
    ]);
    const h = harness({ gh });
    expect(await runFixBrief(h.io)).toBe(0);
    expect(h.out).toHaveLength(1);
    const brief = h.out[0]!;
    expect(brief).toContain("## Item 1 — PRRT_a — bot — `src/a.ts:3`");
    expect(brief).toContain("## Item 2 — PRRT_b — bot — `src/a.ts:3`");
    expect(brief).not.toContain("PRRT_done");
    expect(brief).toContain("Items in this round: 2.");
    expect(h.writes).toEqual([]);
  });

  test("--out writes the brief there and prints a summary, not the brief", async () => {
    const { gh } = ghPages([[{ id: "PRRT_a", isResolved: false }]]);
    const h = harness({ gh, argv: [...ARGV, "--out", "round2.md"] });
    expect(await runFixBrief(h.io)).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.path).toBe("round2.md");
    expect(h.writes[0]!.text).toContain("## Item 1 — PRRT_a");
    expect(h.out.join("\n")).toContain("round2.md");
    expect(h.out.join("\n")).not.toContain("## Item 1");
  });

  test("an existing --out is refused (1) before any forge call, and nothing is written", async () => {
    const h = harness({
      argv: [...ARGV, "--out", "round2.md"],
      exists: async () => true,
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.err.join("\n")).toMatch(/round2\.md already exists/);
    expect(h.writes).toEqual([]);
  });

  test("a file that appears between the pre-check and the write is still refused, and the write error is reported", async () => {
    const { gh } = ghPages([[{ id: "PRRT_a", isResolved: false }]]);
    const h = harness({
      gh,
      argv: [...ARGV, "--out", "r.md"],
      writeExclusive: async () => {
        throw new Error("EEXIST: file already exists, open 'r.md'");
      },
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("EEXIST");
  });

  test("a bad command line is exit 2 and costs no forge call", async () => {
    const h = harness({ argv: ["--pr", "0"] });
    expect(await runFixBrief(h.io)).toBe(2);
    expect(h.err.join("\n")).toMatch(/usage: hexagen-orchestration-fix-brief/);
    const control = harness({ argv: [...ARGV, "--lane", "x\ny"] });
    expect(await runFixBrief(control.io)).toBe(2);
  });

  test("a partial read fails closed: exit 1, the reasons listed, no brief", async () => {
    const h = harness({
      argv: [...ARGV, "--out", "r.md"],
      gh: async () => {
        throw new Error("gh api graphql: rate limited");
      },
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("rate limited");
    expect(h.writes).toEqual([]);
    expect(h.out).toEqual([]);
  });

  test("a PR that cannot be read at all is refused", async () => {
    const h = harness({ gh: async () => JSON.stringify({ data: {} }) });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.err.join("\n")).toMatch(
      /PR #12 does not exist or is not readable/,
    );
    expect(h.out).toEqual([]);
  });

  test("a page-two failure discards the page-one threads rather than briefing from half a PR", async () => {
    let n = 0;
    const h = harness({
      gh: async () => {
        n += 1;
        if (n === 2) throw new Error("boom on page two");
        return JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                id: "PR_1",
                reviewThreads: {
                  pageInfo: { hasNextPage: true, endCursor: "c1" },
                  nodes: [
                    {
                      id: "PRRT_a",
                      isResolved: false,
                      comments: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        });
      },
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.out).toEqual([]);
  });

  test("no unresolved thread still renders a brief, with a note on stderr", async () => {
    const { gh } = ghPages([[{ id: "PRRT_done", isResolved: true }]]);
    const h = harness({ gh });
    expect(await runFixBrief(h.io)).toBe(0);
    expect(h.out[0]).toContain("Items in this round: 0.");
    expect(h.err.join("\n")).toMatch(/no unresolved threads/);
  });
});

describe("fix-brief — the real file edge", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "fix-brief-"));
    dirs.push(dir);
    return dir;
  };

  test("the exclusive writer creates a file and refuses to overwrite one, leaving it untouched", async () => {
    const path = join(tmp(), "b.md");
    expect(await pathExists(path)).toBe(false);
    await exclusiveWriter()(path, "one");
    expect(readFileSync(path, "utf8")).toBe("one");
    expect(await pathExists(path)).toBe(true);
    await expect(exclusiveWriter()(path, "two")).rejects.toThrow(/EEXIST/);
    expect(readFileSync(path, "utf8")).toBe("one");
  });

  test("pathExists is false only for a path that is not there, and rethrows every other failure", async () => {
    const dir = tmp();
    expect(await pathExists(join(dir, "missing.md"))).toBe(false);
    // ENOTDIR: a parent that is a file.
    writeFileSync(join(dir, "plain"), "x");
    expect(await pathExists(join(dir, "plain", "child.md"))).toBe(false);
    // ELOOP: not a path that is absent, so the pre-check must not call it one.
    symlinkSync(join(dir, "b"), join(dir, "a"));
    symlinkSync(join(dir, "a"), join(dir, "b"));
    await expect(pathExists(join(dir, "a"))).rejects.toThrow(/ELOOP/);
  });

  test("a pre-check that cannot decide fails loudly, before any forge call", async () => {
    const h = harness({
      argv: [...ARGV, "--out", "r.md"],
      exists: async () => {
        throw new Error("EACCES: permission denied, access 'r.md'");
      },
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(h.err.join("\n")).toContain("EACCES");
    expect(h.out).toEqual([]);
  });

  test("an existing file at --out is refused end to end and not modified", async () => {
    const path = join(tmp(), "b.md");
    writeFileSync(path, "precious");
    const h = harness({
      argv: [...ARGV, "--out", path],
      exists: pathExists,
      writeExclusive: exclusiveWriter(),
    });
    expect(await runFixBrief(h.io)).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("precious");
  });
});
