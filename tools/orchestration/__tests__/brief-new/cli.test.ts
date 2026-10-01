import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runBriefNew, type BriefNewIo } from "../../src/brief-new/cli.js";
import { exclusiveWriterMakingDirectory } from "../../src/brief-new/files.js";
import { pathExists } from "../../src/fix-brief/files.js";
import type { LaneHost } from "../../src/internal/lane-hosts.js";
import { TEMPLATE_A } from "../../src/brief-new/template-text.js";

const HOSTS: readonly LaneHost[] = [
  { name: "midnight", dispatch: ["ocm-run"], gate: "targeted-only" },
  { name: "local", dispatch: ["run"], gate: "full" },
];

const ARGV = [
  "--lane",
  "PB6",
  "--plan",
  "docs/plan.md",
  "--branch",
  "feat/x",
  "--tip",
  "abc1234",
  "--host",
  "midnight",
];

function harness(over: Partial<BriefNewIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: { path: string; text: string }[] = [];
  const io: BriefNewIo = {
    argv: ARGV,
    hosts: () => HOSTS,
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

const swap = (flag: string, value: string): string[] => {
  const argv = [...ARGV];
  argv[argv.indexOf(flag) + 1] = value;
  return argv;
};

describe("brief-new — the brief", () => {
  test("a targeted-only host: the placeholders are filled, the variant applies, the full gate is forbidden", async () => {
    const h = harness();
    expect(await runBriefNew(h.io)).toBe(0);
    const brief = h.out.join("\n");
    expect(brief).toContain("You are lane PB6 of wave <N> for <REPO_PATH>.");
    expect(brief).toContain("(branch feat/x, based on origin/main abc1234)");
    expect(brief).toContain("1. The plan: docs/plan.md — sections <SECTIONS>.");
    expect(brief).toMatch(/`gate: targeted-only`/);
    expect(brief).toContain("`midnight`");
    expect(brief).toContain("the full gate must NOT be run on this host");
    expect(brief).toContain("Lane-host variant. It applies when");
    expect(brief).toContain("<TARGETED_CHECKS: the exact commands>");
    expect(brief).not.toMatch(/<(LANE|PLAN_PATH|BRANCH|SHA)>/);
  });

  test("a full host: the variant is dropped and the full gate is required", async () => {
    const h = harness({ argv: swap("--host", "local") });
    expect(await runBriefNew(h.io)).toBe(0);
    const brief = h.out.join("\n");
    expect(brief).toMatch(/`gate: full`/);
    expect(brief).toContain("run the full gate");
    expect(brief).not.toContain("Lane-host variant.");
    expect(brief).not.toContain("TARGETED_CHECKS");
    expect(brief).not.toContain("must NOT be run");
  });

  test("--env lines are written verbatim, in order, in a fence longer than any backtick run in them", async () => {
    const h = harness({
      argv: [...ARGV, "--env", "PATH=$HOME/bin:<LANE>", "--env", "Q=```x```"],
    });
    expect(await runBriefNew(h.io)).toBe(0);
    const brief = h.out.join("\n");
    expect(brief).toContain("````\nPATH=$HOME/bin:<LANE>\nQ=```x```\n````");
    // the operator's text is never scanned for placeholders
    expect(brief).toContain("PATH=$HOME/bin:<LANE>");
  });

  test("no --env: the brief is the template with only the four placeholders and the gate policy changed", async () => {
    const h = harness();
    await runBriefNew(h.io);
    expect(h.out.join("\n")).not.toContain("Environment. Set these");
    const head = TEMPLATE_A.slice(0, TEMPLATE_A.indexOf("Read first"));
    expect(head).toContain("<LANE>");
  });

  test("a value that reads like a placeholder is not substituted a second time", async () => {
    const h = harness({ argv: swap("--branch", "feat/<SHA>") });
    // `<` is outside the branch alphabet, so this is refused before any render.
    expect(await runBriefNew(h.io)).toBe(2);
    expect(h.out).toEqual([]);
  });
});

describe("brief-new — refusals", () => {
  test("a bad command line is exit 2 with the usage, and the overlay is never asked", async () => {
    const h = harness({
      argv: swap("--lane", "a b"),
      hosts: () => {
        throw new Error("the overlay must not be read");
      },
    });
    expect(await runBriefNew(h.io)).toBe(2);
    expect(h.err.join("\n")).toMatch(/--lane must be/);
    expect(h.err.join("\n")).toMatch(/usage: hexagen-orchestration-brief-new/);
    expect(h.writes).toEqual([]);
  });

  test("an unknown --host is exit 2, names the flag and the known hosts, and writes nothing", async () => {
    const h = harness({
      argv: [...swap("--host", "nowhere"), "--out", "b.md"],
    });
    expect(await runBriefNew(h.io)).toBe(2);
    expect(h.err.join("\n")).toMatch(
      /--host 'nowhere'.*Known hosts: midnight, local/s,
    );
    expect(h.writes).toEqual([]);
  });

  test("an overlay with no hosts says so", async () => {
    const h = harness({ hosts: () => [] });
    expect(await runBriefNew(h.io)).toBe(2);
    expect(h.err.join("\n")).toMatch(/Known hosts: \(none\)/);
  });

  test("an existing --out is exit 1, and nothing is written", async () => {
    const h = harness({
      argv: [...ARGV, "--out", "b.md"],
      exists: async () => true,
    });
    expect(await runBriefNew(h.io)).toBe(1);
    expect(h.err.join("\n")).toMatch(/b\.md already exists/);
    expect(h.writes).toEqual([]);
  });

  test("a pre-check that cannot answer, and a write that fails, are exit 1", async () => {
    const a = harness({
      argv: [...ARGV, "--out", "b.md"],
      exists: async () => {
        throw new Error("EACCES");
      },
    });
    expect(await runBriefNew(a.io)).toBe(1);
    expect(a.writes).toEqual([]);
    const b = harness({
      argv: [...ARGV, "--out", "b.md"],
      writeExclusive: async () => {
        throw new Error("EEXIST");
      },
    });
    expect(await runBriefNew(b.io)).toBe(1);
    expect(b.err.join("\n")).toMatch(/could not write b\.md: EEXIST/);
  });

  test("--out writes the brief plus a newline and prints a summary instead of the brief", async () => {
    const h = harness({ argv: [...ARGV, "--out", "b.md"] });
    expect(await runBriefNew(h.io)).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.text.endsWith("\n")).toBe(true);
    expect(h.out.join("\n")).toMatch(/^wrote b\.md/);
    expect(h.out.join("\n")).not.toContain("Mode: Implementer");
  });
});

describe("brief-new — the real file edge", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), "brief-new-"));
    dirs.push(dir);
    return dir;
  };

  test("a missing --out directory is created, nested", async () => {
    const dir = scratch();
    const path = join(dir, "a", "b", "brief.md");
    const write = exclusiveWriterMakingDirectory();
    await write(path, "x\n");
    expect(readFileSync(path, "utf8")).toBe("x\n");
  });

  test("the exclusive write refuses a file that appears after the pre-check, and leaves it intact", async () => {
    const dir = scratch();
    const path = join(dir, "sub", "brief.md");
    mkdirSync(join(dir, "sub"));
    const h = harness({
      argv: [...ARGV, "--out", path],
      // the pre-check says "absent", then the file appears before the write
      exists: async () => {
        const answer = await pathExists(path);
        writeFileSync(path, "theirs\n");
        return answer;
      },
      writeExclusive: exclusiveWriterMakingDirectory(),
    });
    expect(await runBriefNew(h.io)).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("theirs\n");
    expect(existsSync(path)).toBe(true);
  });
});
