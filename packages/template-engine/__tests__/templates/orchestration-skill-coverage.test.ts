import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "orchestration",
  "skill-coverage.mjs",
);
const EXTRACTOR = path.join(
  REPO_ROOT,
  "scripts",
  "orchestration",
  "extract-gate-steps.mjs",
);
const FIXTURE = path.resolve(HERE, "..", "fixtures", "orchestration");
const MEMORY_DIR =
  "/Users/martin/.claude/projects/-Users-martin-Projects-Client-work-ADOBE-campaign-foundry/memory";

const REQUIRED_LESSONS = [
  "ci-runners-have-no-zsh.md",
  "a-push-to-main-cancels-the-previous-runs-ci.md",
  "a-mutation-replay-owns-its-worktree.md",
  "lane-liveness-only-the-exit-marker.md",
];

const DEFAULT_STRINGS = [
  "planDir: docs/planning",
  "no forbidden ports",
  "empty list",
  "waveLogDir",
  "$HOME/.waves-<name>",
  "waveStatusPort",
  "4318",
  "mutate: false",
  "requiredCheck: ^Build",
  "overrides: []",
  "statusSource: derived",
  "eventDuty: true",
  "mergeRequiresGreenGate: true",
  "attribution: false",
];

const invariantGlosses = [
  "derived",
  "emit-an-event duty",
  "never merging a red gate",
  "no attribution",
];

const precedenceRule = [
  "may ADD rules",
  "may TIGHTEN rules",
  "may not silently WEAKEN a core invariant",
];

function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-"));
  for (const entry of ["source", "generic", "campaign-foundry"]) {
    fs.cpSync(path.join(FIXTURE, entry), path.join(dir, entry), {
      recursive: true,
    });
  }
  return dir;
}

function run(args: string[]): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return {
    status: result.status,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function coverageArgs(fixture: string, extra: string[] = []): string[] {
  return [
    "--source",
    path.join(fixture, "source"),
    "--tree",
    path.join(fixture, "generic"),
    "--tree",
    path.join(fixture, "campaign-foundry", "overlay"),
    "--allowlist",
    path.join(fixture, "campaign-foundry", "overlay", "coverage-allowlist.txt"),
    "--sites",
    path.join(fixture, "campaign-foundry", "specific-sites.txt"),
    "--generic",
    path.join(fixture, "generic"),
    "--token-review",
    path.join(fixture, "campaign-foundry", "generic-token-review.txt"),
    "--hexagen-root",
    REPO_ROOT,
    ...extra,
  ];
}

function readLines(file: string): string[] {
  return fs.readFileSync(file, "utf8").split("\n");
}

function writeLines(file: string, lines: string[]): void {
  fs.writeFileSync(file, lines.join("\n"));
}

function dropLine(file: string, predicate: (line: string) => boolean): number {
  const lines = readLines(file);
  const index = lines.findIndex(predicate);
  if (index === -1) throw new Error(`no line matched in ${file}`);
  lines.splice(index, 1);
  writeLines(file, lines);
  return index;
}

function dropRun(
  file: string,
  start: (line: string) => boolean,
  keep: (line: string) => boolean,
) {
  const lines = readLines(file);
  const index = lines.findIndex(start);
  if (index === -1) throw new Error(`no start line matched in ${file}`);
  let end = index;
  while (end < lines.length && keep(lines[end])) end++;
  lines.splice(index, end - index);
  writeLines(file, lines);
  return { index, removed: end - index };
}

function dropParagraph(file: string, start: (line: string) => boolean) {
  return dropRun(file, start, (line) => line.trim() !== "");
}

describe("orchestration skill coverage", () => {
  it("is clean over the real fixture, with both tiers' counts asserted", () => {
    const result = run(coverageArgs(FIXTURE));
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain(
      "SKILL.md: 71 anchors, 86 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "rationale.md: 45 anchors, 98 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "cast.md: 35 anchors, 145 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "totals: 151 anchors, 329 paragraphs, over 2 tree(s)",
    );
    expect(result.out).toContain(
      "clean: every anchor and every paragraph of the snapshot survives",
    );
  });

  it("exits 2 on bad arguments and on an unreadable path", () => {
    expect(run([]).status).toBe(2);
    expect(run(["--source", FIXTURE]).status).toBe(2);
    expect(
      run(["--source", FIXTURE, "--tree", FIXTURE, "--allowlist", "/nope/x"])
        .status,
    ).toBe(2);
    expect(
      run([
        "--source",
        "/nope/source",
        "--tree",
        FIXTURE,
        "--allowlist",
        path.join(
          FIXTURE,
          "campaign-foundry",
          "overlay",
          "coverage-allowlist.txt",
        ),
      ]).status,
    ).toBe(2);
  });

  it("red 1: an overlay heading deleted without relocation is named", () => {
    const fixture = copyFixture();
    const cast = path.join(fixture, "campaign-foundry", "overlay", "cast.md");
    dropLine(cast, (line) => line === "## Current seats");
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("cast.md anchor uncovered");
    expect(result.out).toContain("## Current seats");
  });

  it("red 2: a numbered Before-you-dispatch rule deleted from every tree is named", () => {
    const fixture = copyFixture();
    const skill = path.join(fixture, "generic", "SKILL.md");
    dropLine(skill, (line) => line.startsWith("1. **Verify main is green**"));
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("SKILL.md anchor uncovered");
    expect(result.out).toContain("Verify main is green");
  });

  it("red 3: a memory file that is neither cited nor allowlisted is named", () => {
    const fixture = copyFixture();
    const memory = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-memory-"),
    );
    fs.writeFileSync(
      path.join(memory, "a-brand-new-lesson.md"),
      "# a lesson\n\nIt is about nothing yet.\n",
    );
    const lessons = path.join(
      fixture,
      "campaign-foundry",
      "overlay",
      "lessons.md",
    );
    const withMemory = ["--memory", memory, "--lessons", lessons];
    const uncited = run(coverageArgs(fixture, withMemory));
    expect(uncited.status, uncited.out).toBe(1);
    expect(uncited.out).toContain("a-brand-new-lesson.md");
    expect(uncited.out).toContain("neither cited");

    fs.appendFileSync(lessons, "\nsource: a-brand-new-lesson.md\n");
    const cited = run(coverageArgs(fixture, withMemory));
    expect(cited.status, cited.out).toBe(0);
  });

  it("red 4: a body paragraph deleted while its heading survives is named", () => {
    const fixture = copyFixture();
    const target = "Four lanes in one session exited";
    let removedFrom = 0;
    for (const tree of ["generic", path.join("campaign-foundry", "overlay")]) {
      const dir = path.join(fixture, tree);
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (!fs.statSync(file).isFile() || !name.endsWith(".md")) continue;
        if (!readLines(file).some((line) => line.startsWith(target))) continue;
        const { index, removed } = dropParagraph(file, (line) =>
          line.startsWith(target),
        );
        expect(removed, `paragraph for ${target} in ${name}`).toBe(4);
        const heading = readLines(file)
          .slice(0, index)
          .filter((line) => line.startsWith("#"));
        expect(
          heading.length,
          "the heading above the paragraph is still there",
        ).toBeGreaterThan(0);
        removedFrom++;
      }
    }
    expect(
      removedFrom,
      "the paragraph survived in at least one tree",
    ).toBeGreaterThan(0);
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("rationale.md paragraph uncovered");
    expect(result.out).toContain("Four lanes in one session exited");
  });

  it("red 5: the graded-record table deleted while its heading survives is named", () => {
    const fixture = copyFixture();
    const cast = path.join(fixture, "campaign-foundry", "overlay", "cast.md");
    const { removed } = dropRun(
      cast,
      (line) => line === "| Seat | Lanes | Result |",
      (line) => line.startsWith("|"),
    );
    expect(
      removed,
      "the graded-record table has eight rows of header, rule and body",
    ).toBe(8);
    const text = fs.readFileSync(cast, "utf8");
    expect(text).toContain("### Graded record, waves w05 and w06");
    expect(text).not.toContain("| Seat | Lanes | Result |");
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("cast.md paragraph uncovered");
    expect(result.out).toContain("| Seat | Lanes | Result |");
  });

  it("red 6: a token generated at runtime, planted as an inline code span, is named", () => {
    const fixture = copyFixture();
    const canary = `cf-sweep-canary-${randomUUID().slice(0, 8)}`;
    plantInlineCanary(fixture, canary);
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("unaccounted");
    expect(result.out).toContain(canary);
  });

  it("red 7: the same canary planted only inside a fenced block is named too", () => {
    const fixture = copyFixture();
    const canary = `cf-sweep-canary-${randomUUID().slice(0, 8)}`;
    plantFencedCanary(fixture, canary);
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("unaccounted");
    expect(result.out).toContain(canary);
  });

  it("generic/ contains no line of specific-sites.txt", () => {
    const sites = fs
      .readFileSync(
        path.join(FIXTURE, "campaign-foundry", "specific-sites.txt"),
        "utf8",
      )
      .split("\n")
      .filter((line) => line.trim());
    expect(sites.length).toBe(43);
    const genericDir = path.join(FIXTURE, "generic");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(genericDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const site of sites) {
        expect(
          text.includes(site),
          `${path.basename(file)} contains ${JSON.stringify(site)}`,
        ).toBe(false);
      }
    }
  });

  it("lessons.md cites the four named memory files, and allowlists none of them", () => {
    const lessons = fs.readFileSync(
      path.join(FIXTURE, "campaign-foundry", "overlay", "lessons.md"),
      "utf8",
    );
    const allowlist = fs
      .readFileSync(
        path.join(
          FIXTURE,
          "campaign-foundry",
          "overlay",
          "coverage-allowlist.txt",
        ),
        "utf8",
      )
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => line.trim());
    for (const name of REQUIRED_LESSONS) {
      expect(lessons.split("\n"), `lessons.md cites ${name}`).toContain(
        `source: ${name}`,
      );
      expect(allowlist, `${name} is not allowlisted`).not.toContain(name);
    }
  });

  it("generic/SKILL.md states the loading defaults, the invariants and the precedence rule", () => {
    const raw = fs.readFileSync(
      path.join(FIXTURE, "generic", "SKILL.md"),
      "utf8",
    );
    const skill = raw.replace(/\s+/g, " ");
    for (const text of DEFAULT_STRINGS) {
      expect(skill.includes(text), `default present: ${text}`).toBe(true);
    }
    for (const text of invariantGlosses) {
      expect(skill.includes(text), `invariant gloss present: ${text}`).toBe(
        true,
      );
    }
    for (const text of precedenceRule) {
      expect(skill.includes(text), `precedence rule present: ${text}`).toBe(
        true,
      );
    }
    expect(skill).toContain(
      "Read `.agents/orchestration/config.yaml` right after this contract",
    );
    expect(skill).toContain(
      "An `overrides:` entry is surfaced before the first lane dispatches",
    );
  });

  it("expected-steps.tsv is the 11 lines the extractor derives, and stays derived", () => {
    const tsv = path.join(FIXTURE, "campaign-foundry", "expected-steps.tsv");
    const lines = fs
      .readFileSync(tsv, "utf8")
      .split("\n")
      .filter((line) => line.length);
    expect(lines).toHaveLength(11);
    expect(lines.map((line) => line.split("\t")[0])).toEqual([
      "check:env",
      "build",
      "typecheck",
      "lint",
      "format:check",
      "lint:arch",
      "sync:check",
      "lint:bytes",
      "plan:verify",
      "test:cov",
      "verify-manifests",
    ]);
    for (const line of lines) {
      expect(line.split("\t"), `tab-separated: ${line}`).toHaveLength(2);
    }
    const text = fs.readFileSync(tsv, "utf8");
    expect(text).not.toContain("arch:inventory");
    expect(text).not.toContain("nitro-route-scan");
    const regenerated = spawnSync(
      process.execPath,
      [EXTRACTOR, path.join(FIXTURE, "source", "gate.sh")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(regenerated.status, regenerated.stderr).toBe(0);
    expect(regenerated.stdout).toBe(text);
  });

  it.skipIf(!fs.existsSync(MEMORY_DIR))(
    "every memory file is either cited with a source line or allowlisted with a reason",
    () => {
      const files = fs
        .readdirSync(MEMORY_DIR)
        .filter((name) => name.endsWith(".md"));
      const lessons = fs.readFileSync(
        path.join(FIXTURE, "campaign-foundry", "overlay", "lessons.md"),
        "utf8",
      );
      const allowlisted = new Set(
        fs
          .readFileSync(
            path.join(
              FIXTURE,
              "campaign-foundry",
              "overlay",
              "coverage-allowlist.txt",
            ),
            "utf8",
          )
          .split("\n")
          .filter((line) => line.trim() && !line.trim().startsWith("#"))
          .map((line) => line.trim()),
      );
      expect(files).toHaveLength(51);
      for (const name of files) {
        const cited = lessons.split("\n").includes(`source: ${name}`);
        expect(cited || allowlisted.has(name), `${name} is accounted for`).toBe(
          true,
        );
      }
      const citedCount = files.filter((name) =>
        lessons.split("\n").includes(`source: ${name}`),
      );
      expect(citedCount.length + allowlisted.size).toBe(51);
      const result = run(
        coverageArgs(FIXTURE, [
          "--memory",
          MEMORY_DIR,
          "--lessons",
          path.join(FIXTURE, "campaign-foundry", "overlay", "lessons.md"),
        ]),
      );
      expect(result.status, result.out).toBe(0);
      expect(result.out).toContain(
        "memory: 51 files, 32 cited, 19 allowlisted",
      );
    },
  );
});

function plantInlineCanary(fixture: string, canary: string): void {
  const marker =
    "**Every lane brief ends with two lines, and they are not optional.** Both were earned:";
  for (const file of [
    path.join(fixture, "source", "SKILL.md"),
    path.join(fixture, "generic", "SKILL.md"),
  ]) {
    const lines = readLines(file);
    const index = lines.indexOf(marker);
    if (index === -1) throw new Error(`marker not found in ${file}`);
    lines[index] = `${lines[index]} \`${canary}\``;
    writeLines(file, lines);
  }
}

function plantFencedCanary(fixture: string, canary: string): void {
  const marker =
    "   for d in node_modules/@*/*darwin*/ node_modules/*darwin*/; do";
  for (const file of [
    path.join(fixture, "source", "SKILL.md"),
    path.join(fixture, "generic", "SKILL.md"),
  ]) {
    const lines = readLines(file);
    const index = lines.indexOf(marker);
    if (index === -1) throw new Error(`fence marker not found in ${file}`);
    lines.splice(index + 1, 0, `    echo \`${canary}\``);
    writeLines(file, lines);
  }
}
