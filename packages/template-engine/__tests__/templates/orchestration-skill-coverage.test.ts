import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// The scrubbed skill's ONE canonical home, since OW4 moved it out of the fixture: the template's
// `files/` tree, the bytes `hexagen add orchestration` emits into a consumer project. OW-D2/OW-D13
// keep the template copy as the single owner, and a fixture copy alongside it would be a second one
// that could drift. The fixture keeps `source/` (the left-hand side of the coverage question) and
// `campaign-foundry/` (the worked overlay); the skill itself is read, and tested, where it ships.
const GENERIC = path.resolve(
  HERE,
  "..",
  "..",
  "templates",
  "orchestration",
  "files",
  ".agents",
  "skills",
  "orchestrate-wave",
);
// The live memory directory is the owner's, outside the repository. The audit against it runs only
// when ORCHESTRATION_MEMORY_DIR points at it; CI runs the committed manifest instead.
// turbo/no-undeclared-env-vars: ORCHESTRATION_MEMORY_DIR is an operator-set variable that enables an
// optional local audit. It is not a build input, so turbo's cache has nothing to invalidate, and
// turbo.json is a never-edit file.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const MEMORY_DIR: string | undefined = process.env.ORCHESTRATION_MEMORY_DIR;
const HAS_MEMORY_DIR = Boolean(MEMORY_DIR && fs.existsSync(MEMORY_DIR));

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

const MANIFEST = path.join(FIXTURE, "campaign-foundry", "memory-manifest.txt");

function copyFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-"));
  for (const entry of ["source", "campaign-foundry"]) {
    fs.cpSync(path.join(FIXTURE, entry), path.join(dir, entry), {
      recursive: true,
    });
  }
  // The skill is not in the fixture any more, so the temp tree gets it under
  // the name every `path.join(fixture, "generic", …)` below already expects.
  fs.cpSync(GENERIC, path.join(dir, "generic"), { recursive: true });
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

/**
 * Where the scrubbed skill sits for a given fixture root. The real fixture has
 * no `generic/` directory any more — the skill moved into the template — so it
 * resolves to `GENERIC`; a `copyFixture()` temp tree keeps a `generic/` copy
 * that the red cases below mutate in place, and those mutations must be the
 * tree the CLI reads or they would prove nothing.
 */
function skillDir(fixture: string): string {
  return fixture === FIXTURE ? GENERIC : path.join(fixture, "generic");
}

function coverageArgs(fixture: string, extra: string[] = []): string[] {
  return [
    "--source",
    path.join(fixture, "source"),
    "--tree",
    skillDir(fixture),
    "--tree",
    path.join(fixture, "campaign-foundry", "overlay"),
    "--allowlist",
    path.join(fixture, "campaign-foundry", "overlay", "coverage-allowlist.txt"),
    "--sites",
    path.join(fixture, "campaign-foundry", "specific-sites.txt"),
    "--generic",
    skillDir(fixture),
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
      "SKILL.md: 71 anchors [heading, boldLead], 86 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "rationale.md: 45 anchors [heading], 98 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "cast.md: 35 anchors [heading], 145 paragraphs, both asserted",
    );
    expect(result.out).toContain(
      "totals: 151 anchors, 329 paragraphs, over 2 tree(s)",
    );
    expect(result.out).toContain(
      "clean: every anchor and every paragraph of the snapshot survives",
    );
  });

  it("F1: bold leads anchor in SKILL.md only, headings alone in the other two files", () => {
    const script = fs.readFileSync(SCRIPT, "utf8");
    expect(script).toContain('anchorKinds: ["heading", "boldLead"]');
    expect(script.match(/anchorKinds: \["heading"\]/g)).toHaveLength(2);
    const result = run(coverageArgs(FIXTURE));
    expect(result.out).toContain("SKILL.md: 71 anchors [heading, boldLead]");
    expect(result.out).toContain("rationale.md: 45 anchors [heading]");
    expect(result.out).toContain("cast.md: 35 anchors [heading]");
  });

  it("snapshot: a one-byte edit of source/SKILL.md is named, though every count holds", () => {
    const clean = run(coverageArgs(FIXTURE));
    expect(clean.out).toContain("snapshot: 5 file(s) match");
    const fixture = copyFixture();
    const file = path.join(fixture, "source", "SKILL.md");
    const bytes = fs.readFileSync(file);
    // "the" -> "thf" inside a paragraph changes one byte and no unit count.
    const at = bytes.indexOf("the ");
    bytes[at + 2] = "f".charCodeAt(0);
    fs.writeFileSync(file, bytes);
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("source/SKILL.md is not the pinned snapshot");
  });

  it("allowlist: an entry with no comment block directly above it is named", () => {
    const fixture = copyFixture();
    const allowlist = path.join(
      fixture,
      "campaign-foundry",
      "overlay",
      "coverage-allowlist.txt",
    );
    fs.appendFileSync(allowlist, "\na-bare-entry.md\n");
    let result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("a-bare-entry.md");
    expect(result.out).toContain("has no reason");
    // A blank line between the comment and the entry also leaves it bare.
    fs.appendFileSync(allowlist, "# a reason\n\nanother-bare-entry.md\n");
    result = run(coverageArgs(fixture));
    expect(result.out).toContain("another-bare-entry.md");
  });

  it("memory: an empty manifest is a failure, not a clean check of nothing", () => {
    const fixture = copyFixture();
    const manifest = path.join(fixture, "empty-manifest.txt");
    fs.writeFileSync(manifest, "# nothing here\n");
    const result = run(
      coverageArgs(fixture, [
        "--memory-manifest",
        manifest,
        "--lessons",
        path.join(fixture, "campaign-foundry", "overlay", "lessons.md"),
      ]),
    );
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("no memory files to classify");
  });

  it("memory: an allowlist entry that is not a classified file is named", () => {
    const fixture = copyFixture();
    const allowlist = path.join(
      fixture,
      "campaign-foundry",
      "overlay",
      "coverage-allowlist.txt",
    );
    fs.appendFileSync(
      allowlist,
      "\n# A reason, but for a file that is not in the manifest.\na-stale-entry.md\n",
    );
    const result = run(
      coverageArgs(fixture, [
        "--memory-manifest",
        path.join(fixture, "campaign-foundry", "memory-manifest.txt"),
        "--lessons",
        path.join(fixture, "campaign-foundry", "overlay", "lessons.md"),
      ]),
    );
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("a-stale-entry.md");
    expect(result.out).toContain(
      "is not one of the 51 classified memory files",
    );
  });

  it("floors: a comment-only sites file, an empty generic dir and a spanless generic dir each fail", () => {
    const fixture = copyFixture();
    const sites = path.join(fixture, "campaign-foundry", "specific-sites.txt");
    const real = fs.readFileSync(sites, "utf8");
    fs.writeFileSync(sites, "# nothing listed\n");
    let result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("lists no strings");
    fs.writeFileSync(sites, real);

    const empty = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-empty-"),
    );
    result = run(coverageArgs(fixture, ["--generic", empty]));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("has no files");
    expect(result.out).toContain("yielded no code spans");

    const plain = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-plain-"),
    );
    fs.writeFileSync(path.join(plain, "SKILL.md"), "Plain prose, no spans.\n");
    result = run(coverageArgs(fixture, ["--generic", plain]));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("yielded no code spans");
    expect(result.out).not.toContain("has no files");
  });

  it("floors: a hexagen root with no tracked files fails the token sweep", () => {
    const fixture = copyFixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-root-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
    const result = run(coverageArgs(fixture, ["--hexagen-root", root]));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("no tracked hexagen file was readable");
  });

  it("fences: a line of backticks followed by text does not close a fence", async () => {
    const units = (await import(pathToFileURL(SCRIPT).href)) as {
      contentUnits: (text: string) => string[];
      anchorUnits: (text: string, kinds: string[]) => string[];
      fencedWords: (text: string) => string[];
    };
    const text = [
      "Before.",
      "",
      "```bash",
      "echo one",
      "``` not a closer",
      "# not a heading, still inside",
      "echo two",
      "```",
      "",
      "After.",
      "",
      "````md",
      "```",
      "inside a four-tick fence",
      "````",
      "",
      "## Real heading",
      "",
    ].join("\n");
    const found = units.contentUnits(text);
    expect(found).toHaveLength(5);
    expect(found[1]).toContain("``` not a closer");
    expect(found[1]).toContain("echo two");
    expect(found[3]).toContain("inside a four-tick fence");
    expect(units.anchorUnits(text, ["heading"])).toEqual(["## Real heading"]);
    expect(units.fencedWords(text)).toContain("closer");
    expect(units.fencedWords(text)).toContain("four-tick");
  });

  it("args: --token-review without --generic exits 2", () => {
    const result = run([
      "--source",
      path.join(FIXTURE, "source"),
      "--tree",
      GENERIC,
      "--allowlist",
      path.join(
        FIXTURE,
        "campaign-foundry",
        "overlay",
        "coverage-allowlist.txt",
      ),
      "--token-review",
      path.join(FIXTURE, "campaign-foundry", "generic-token-review.txt"),
      "--hexagen-root",
      REPO_ROOT,
    ]);
    expect(result.status, result.out).toBe(2);
    expect(result.out).toContain("--token-review also needs --generic");
  });

  it.skipIf(process.getuid?.() === 0)(
    "args: an unreadable nested source directory exits 2, not an uncaught 1",
    () => {
      const fixture = copyFixture();
      const nested = path.join(fixture, "source", "extra");
      fs.mkdirSync(nested);
      fs.chmodSync(nested, 0o000);
      try {
        const result = run(coverageArgs(fixture));
        expect(result.status, result.out).toBe(2);
        expect(result.out).toContain("cannot read directory");
      } finally {
        fs.chmodSync(nested, 0o755);
      }
    },
  );

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
    // Every allowlisted name must exist too, or the stale-entry check fires first.
    for (const name of readLines(MANIFEST).filter((line) => line.trim())) {
      fs.writeFileSync(path.join(memory, name), "# stand-in\n");
    }
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

  it("bundle: a skill-only token that the generated bundle also embeds is still named", () => {
    const fixture = copyFixture();
    const canary = `cf-bundle-canary-${randomUUID().slice(0, 8)}`;
    plantInlineCanary(fixture, canary);
    // A stand-in hexagen checkout: the generated bundle embeds the skill text, so it carries the
    // canary too, next to an unrelated tracked file that keeps the corpus non-empty. The bundle is
    // not a second place the token lives; it is the skill again, and must not count as one.
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-bundle-"),
    );
    const git = (...args: string[]) =>
      spawnSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args],
        {
          cwd: root,
        },
      );
    git("init", "-q");
    const bundle = path.join(
      root,
      "packages/template-engine/src/infrastructure/generated/template-bundle.generated.ts",
    );
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, `export const x = "${canary}";\n`);
    fs.writeFileSync(path.join(root, "README.md"), "unrelated\n");
    git("add", ".");
    const result = run(coverageArgs(fixture, ["--hexagen-root", root]));
    expect(result.status, result.out).toBe(1);
    // The stand-in tracks little, so many other tokens are flagged too: assert on the canary's own
    // line, not on anything about the rest of the report.
    const line = result.out.split("\n").find((l) => l.includes(canary));
    expect(line, result.out).toBeDefined();
    expect(line).toMatch(/needs a line/);
  });

  it("mirror: a skill-only token that the tracked skill mirror also carries is still named", () => {
    const fixture = copyFixture();
    const canary = `cf-mirror-canary-${randomUUID().slice(0, 8)}`;
    plantInlineCanary(fixture, canary);
    // A stand-in hexagen checkout whose ONLY tracked copy of the canary is the hexagen-only skill
    // mirror (`.agents/skills/orchestrate-wave/`, byte-identical to the template's copy). The mirror
    // is the skill again, not a second place a token lives: left in the corpus it would make the
    // sweep pass vacuously, so the canary must still be flagged.
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-mirror-"),
    );
    const git = (...args: string[]) =>
      spawnSync(
        "git",
        ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args],
        { cwd: root },
      );
    git("init", "-q");
    const mirror = path.join(
      root,
      ".agents/skills/orchestrate-wave/references/planted.md",
    );
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.writeFileSync(mirror, `planted: ${canary}\n`);
    fs.writeFileSync(path.join(root, "README.md"), "unrelated\n");
    git("add", ".");
    const result = run(coverageArgs(fixture, ["--hexagen-root", root]));
    expect(result.status, result.out).toBe(1);
    const line = result.out.split("\n").find((l) => l.includes(canary));
    expect(line, result.out).toBeDefined();
    expect(line).toMatch(/needs a line/);
  });

  it("a report larger than the pipe buffer is delivered whole to a slow reader", () => {
    const fixture = copyFixture();
    // An empty-ish hexagen checkout flags hundreds of tokens, so the report is ~100 KB, well past a
    // 64 KB pipe. The reader sleeps before it drains; a process.exit() on the way out would drop the
    // tail, summary line and all.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-coverage-pipe-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
    fs.writeFileSync(path.join(root, "README.md"), "unrelated\n");
    spawnSync("git", ["add", "."], { cwd: root });
    const args = coverageArgs(fixture, ["--hexagen-root", root]);
    const result = spawnSync(
      "sh",
      [
        "-c",
        `"$0" "$@" 2>&1 | (sleep 1; cat)`,
        process.execPath,
        SCRIPT,
        ...args,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1 << 26 },
    );
    expect(result.stdout.length).toBeGreaterThan(70_000);
    expect(result.stdout).toMatch(/tokens: .* \d+ unaccounted/);
    expect(result.stdout).toContain("UNCOVERED:");
  });

  it("F16: a code span with internal whitespace, planted in source and generic, is named", () => {
    const fixture = copyFixture();
    // Generated at runtime, with two spaces inside: a literal in this file would be found by the
    // tracked-file sweep and never flagged.
    const span = `cf-only  ${randomUUID().slice(0, 8)}`;
    const marker =
      "**Every lane brief ends with two lines, and they are not optional.** Both were earned:";
    for (const file of [
      path.join(fixture, "source", "SKILL.md"),
      path.join(fixture, "generic", "SKILL.md"),
    ]) {
      const lines = readLines(file);
      const index = lines.indexOf(marker);
      if (index === -1) throw new Error(`marker not found in ${file}`);
      lines[index] = `${lines[index]} \`${span}\``;
      writeLines(file, lines);
    }
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain(span);
    expect(result.out).toContain("unaccounted");
  });

  it("F16: the wrapped TIMED-OUT span needs its review line, matched raw", () => {
    const fixture = copyFixture();
    const review = path.join(
      fixture,
      "campaign-foundry",
      "generic-token-review.txt",
    );
    const raw = readLines(review).find((line) => line.startsWith("TIMED-OUT"));
    expect(raw).toContain("decide\\n   quickly");
    dropLine(review, (line) => line.startsWith("TIMED-OUT"));
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("TIMED-OUT");
    expect(result.out).toContain("unaccounted");
  });

  it("F17: an anchor whose inner spacing changed is not the same line", () => {
    const fixture = copyFixture();
    const cast = path.join(fixture, "campaign-foundry", "overlay", "cast.md");
    const lines = readLines(cast);
    const index = lines.indexOf("## Current seats");
    expect(index).toBeGreaterThan(-1);
    lines[index] = "## Current  seats";
    writeLines(cast, lines);
    const result = run(coverageArgs(fixture));
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("cast.md anchor uncovered");
    expect(result.out).toContain("## Current seats");
  });

  it("F2: a manifest name that is neither cited nor allowlisted is named", () => {
    const fixture = copyFixture();
    const manifest = path.join(fixture, "manifest.txt");
    fs.writeFileSync(manifest, "a-name-nobody-cited.md\n");
    const lessons = path.join(
      fixture,
      "campaign-foundry",
      "overlay",
      "lessons.md",
    );
    const result = run(
      coverageArgs(fixture, [
        "--memory-manifest",
        manifest,
        "--lessons",
        lessons,
      ]),
    );
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain("a-name-nobody-cited.md");
    expect(result.out).toContain("neither cited");
  });

  it("F2: a memory directory file missing from the manifest is named", () => {
    const fixture = copyFixture();
    const memory = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-coverage-memory-"),
    );
    fs.writeFileSync(path.join(memory, "MEMORY.md"), "# index\n");
    fs.writeFileSync(path.join(memory, "extra-not-in-manifest.md"), "# x\n");
    const manifest = path.join(fixture, "manifest.txt");
    fs.writeFileSync(manifest, "MEMORY.md\nmanifest-only-name.md\n");
    const lessons = path.join(
      fixture,
      "campaign-foundry",
      "overlay",
      "lessons.md",
    );
    const result = run(
      coverageArgs(fixture, [
        "--memory",
        memory,
        "--memory-manifest",
        manifest,
        "--lessons",
        lessons,
      ]),
    );
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain(
      "extra-not-in-manifest.md is in the memory directory but not in the manifest",
    );
    expect(result.out).toContain("manifest-only-name.md is in the manifest");
  });

  it("F2: the committed manifest classifies clean with no memory directory (the CI path)", () => {
    const manifest = path.join(
      FIXTURE,
      "campaign-foundry",
      "memory-manifest.txt",
    );
    const names = fs
      .readFileSync(manifest, "utf8")
      .split("\n")
      .filter((line) => line.trim());
    expect(names).toHaveLength(51);
    const result = run(
      coverageArgs(FIXTURE, [
        "--memory-manifest",
        manifest,
        "--lessons",
        path.join(FIXTURE, "campaign-foundry", "overlay", "lessons.md"),
      ]),
    );
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain("memory: 51 files, 32 cited, 19 allowlisted");
  });

  it("F6: every #anchor link in generic/ resolves to a heading slug", () => {
    const slug = (heading: string): string =>
      heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s/g, "-");
    const slugsOf = (file: string): Set<string> => {
      const out = new Set<string>();
      let inFence = false;
      for (const line of readLines(file)) {
        if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) inFence = !inFence;
        const match = !inFence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
        if (match) out.add(slug(match[1]));
      }
      return out;
    };
    const generic = GENERIC;
    const skill = path.join(generic, "SKILL.md");
    const rationale = path.join(generic, "references", "rationale.md");
    const targets: Record<string, Set<string>> = {
      "": slugsOf(skill),
      "references/rationale.md": slugsOf(rationale),
    };
    let checked = 0;
    for (const file of [skill, rationale]) {
      const own = file === skill ? "" : "references/rationale.md";
      const text = fs.readFileSync(file, "utf8");
      for (const link of text.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
        const target = link[1] === "" ? own : link[1];
        const slugs = targets[target];
        if (!slugs) continue;
        checked++;
        expect(
          slugs.has(link[2]),
          `${path.basename(file)} links #${link[2]}, which is no heading of ${target || "SKILL.md"}`,
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("generic/ names no incident date", () => {
    for (const name of ["SKILL.md", path.join("references", "rationale.md")]) {
      const text = fs.readFileSync(path.join(GENERIC, name), "utf8");
      expect(text.match(/2026-\d\d-\d\d/g) ?? [], name).toEqual([]);
    }
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
    const genericDir = GENERIC;
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
    const raw = fs.readFileSync(path.join(GENERIC, "SKILL.md"), "utf8");
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
    // Project-specific guards and runbooks are conditional in the generic skill.
    expect(skill).toContain(
      "A project-specific guard (for example a route-registry scan) belongs in `gateSteps` as its own step",
    );
    expect(skill).not.toContain("A route-registry guard is a gate step");
    expect(skill).toContain("where the project ships them, both runbooks");
    expect(skill).not.toContain(
      "Read the plan and both documents before acting",
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

  it.skipIf(!HAS_MEMORY_DIR)(
    "every memory file is either cited with a source line or allowlisted with a reason",
    () => {
      const files = fs
        .readdirSync(MEMORY_DIR as string)
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
          MEMORY_DIR as string,
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
