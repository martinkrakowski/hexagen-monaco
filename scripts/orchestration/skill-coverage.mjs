#!/usr/bin/env node
// Checks that the scrub lost nothing.
//
// The owner's requirement is that every rule and incident in the pinned snapshot exists either in
// the generic skill or in campaign-foundry's overlay. A prose claim that it does is worth nothing,
// so this computes the claim: it extracts two kinds of unit from each snapshot file and requires
// each one to appear, whole, somewhere in the trees it is given.
//
// Two tiers, both counted OUTSIDE fenced code, because a rule that lives inside a code block is
// not a rule:
//
//   anchors — every ATX heading line, and every line whose first token, after optional
//   indentation and an optional list marker (`-`, `*`, `N.`), is `**`. Matched as a WHOLE LINE:
//   the trimmed source line has to equal a trimmed line of some file in a tree. Never a substring.
//   A rule that survives as a fragment of a longer line has not survived.
//
//   content — every paragraph (a maximal run of non-blank lines outside fences) and every fenced
//   block whole. Matched whole and verbatim after collapsing whitespace runs to one space, against
//   a paragraph or a fenced block of some tree file. This is the tier that makes "moved, never
//   deleted" checkable: a paragraph the scrub rewrote for the generic skill still passes, but only
//   because its original sits verbatim in the overlay.
//
// The unit counts are asserted before a clean result is reported. That is not decoration: a count
// that silently drops is a unit the extractor stopped seeing, which is exactly the silent thinning
// this check exists to prevent.
//
// Both --tree paths are parameters, never constants. OW4 re-points this at the template's own
// `files/` copy and OW8 at an installed tree, with no second script.
//
// Exit codes: 0 clean, 1 something is uncovered (each missing unit is named), 2 bad arguments or
// an unreadable path.
//
// Usage:
//   node scripts/orchestration/skill-coverage.mjs --source <dir> --tree <dir> [--tree <dir>…]
//     --allowlist <file> [--sites <file> --generic <dir>] [--memory <dir> --lessons <file>]
//     [--token-review <file>] [--hexagen-root <dir>]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

// The unit counts at the pin, keyed by the snapshot file's path relative to --source. Asserted,
// not documented: if the extractor changes shape and starts seeing fewer units, that is a
// regression in the check and has to fail loudly.
//
// `boldLeads` says whether a bold-lead line is an anchor unit in that file, on top of its
// headings. It is true for SKILL.md (9 headings + 62 bold leads = 71) and false for the other two,
// whose anchors are their headings alone: 1 + 7 + 37 = 45 and 1 + 15 + 19 = 35. Those are the
// counts the plan enumerates per file and the counts the test asserts.
//
// Nothing is checked less for it. In both of those files every bold-lead line is the *first* line
// of a paragraph, so the content tier already requires that exact line to survive verbatim; an
// anchor unit for it would be a second copy of a requirement the content tier is already
// enforcing. The anchor tier earns its place in SKILL.md because a heading there is its own unit,
// separate from the paragraph beneath it.
const EXPECTED_UNITS = {
  "SKILL.md": { path: "SKILL.md", anchors: 71, content: 86, boldLeads: true },
  "rationale.md": { path: "references/rationale.md", anchors: 45, content: 98, boldLeads: false },
  "cast.md": { path: "references/cast.md", anchors: 35, content: 145, boldLeads: false },
};

// The snapshot files the two tiers are computed over. `gate.sh` and `wave-event.sh` are
// snapshots too, but they are machinery rather than prose: the shim's fix is to *stop* climbing
// four directories, so there is nothing in it to preserve verbatim.
const UNIT_FILES = Object.entries(EXPECTED_UNITS).map(([name, spec]) => ({ name, ...spec }));

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const BOLD_LEAD = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*/;

const collapse = (text) => text.replace(/\s+/g, " ").trim();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Paragraphs and fenced blocks, in order. Fences are returned whole, delimiters included. */
function contentUnits(text) {
  const units = [];
  let paragraph = [];
  let inFence = false;
  let fenceChar = null;
  const flush = () => {
    if (paragraph.length) units.push(paragraph.join("\n"));
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      if (!inFence) {
        flush();
        inFence = true;
        fenceChar = fence[1][0];
        paragraph = [line];
      } else if (fence[1][0] === fenceChar) {
        paragraph.push(line);
        flush();
        inFence = false;
      } else {
        paragraph.push(line);
      }
      continue;
    }
    if (inFence) {
      paragraph.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return units;
}

/** Heading lines and bold-lead lines, outside fenced code. */
function anchorUnits(text, boldLeads = true) {
  const anchors = [];
  let inFence = false;
  let fenceChar = null;
  for (const line of text.split("\n")) {
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    if (HEADING.test(line) || (boldLeads && BOLD_LEAD.test(line))) anchors.push(line);
  }
  return anchors;
}

/** Inline code spans: one matched backtick run, the interior whole, one surrounding space stripped. */
function codeSpans(text) {
  const spans = [];
  const pattern = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  let match;
  while ((match = pattern.exec(text))) {
    let body = match[2];
    if (/[^ ]/.test(body) && body.startsWith(" ") && body.endsWith(" ")) body = body.slice(1, -1);
    spans.push(body);
  }
  return spans;
}

/** Every whitespace-separated word inside a fenced block. */
function fencedWords(text) {
  const words = [];
  let inFence = false;
  let fenceChar = null;
  for (const line of text.split("\n")) {
    const fence = line.match(FENCE_OPEN);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (!inFence) continue;
    for (const word of line.split(/\s+/)) if (word) words.push(word);
  }
  return words;
}

function parseArgs(argv) {
  const opts = { trees: [] };
  const takesValue = new Set([
    "--source",
    "--tree",
    "--allowlist",
    "--sites",
    "--generic",
    "--memory",
    "--lessons",
    "--token-review",
    "--hexagen-root",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!takesValue.has(arg)) fail(`unknown argument: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`);
    i++;
    if (arg === "--tree") opts.trees.push(value);
    else opts[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const required of ["source", "allowlist"]) {
    if (!opts[required]) fail(`--${required} is required`);
  }
  if (opts.trees.length === 0) fail("--tree is required, at least once");
  if ((opts.sites && !opts.generic) || (opts.generic && !opts.sites)) {
    fail("--sites and --generic must be given together");
  }
  if ((opts.memory && !opts.lessons) || (opts.lessons && !opts.memory)) {
    fail("--memory and --lessons must be given together");
  }
  if (opts.tokenReview && !opts.hexagenRoot) {
    fail("--token-review also needs --hexagen-root, so the sweep knows what counts as tracked");
  }
  return opts;
}

let failures = 0;
const say = (line) => process.stdout.write(`${line}\n`);
const bad = (line) => {
  failures++;
  process.stdout.write(`${line}\n`);
};

function fail(message) {
  process.stderr.write(`skill-coverage: ${message}\n`);
  process.exit(2);
}

function readFile(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail(`cannot read ${what}: ${path}`);
  }
}

function readTree(dir) {
  let entries;
  try {
    entries = walk(dir);
  } catch {
    return fail(`cannot read tree: ${dir}`);
  }
  const lines = new Set();
  const content = new Set();
  for (const path of entries) {
    const text = readFile(path, `file in tree ${dir}`);
    for (const line of text.split("\n")) lines.add(collapse(line));
    for (const unit of contentUnits(text)) content.add(collapse(unit));
  }
  return { lines, content, files: entries };
}

function checkCounts(name, sourceText) {
  const expected = EXPECTED_UNITS[name];
  const anchors = anchorUnits(sourceText, expected.boldLeads).length;
  const content = contentUnits(sourceText).length;
  if (anchors !== expected.anchors || content !== expected.content) {
    bad(
      `${name}: unit count is ${anchors} anchors / ${content} content, expected ` +
        `${expected.anchors} / ${expected.content}. The extractor changed shape; fix it before ` +
        `trusting a clean result.`,
    );
  }
  return { anchors, content };
}

function checkSites(sitesPath, genericDir) {
  const sites = readFile(sitesPath, "sites file")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  let files;
  try {
    files = walk(genericDir);
  } catch {
    return fail(`cannot read generic tree: ${genericDir}`);
  }
  for (const path of files) {
    const text = readFile(path, `file in generic tree ${genericDir}`);
    for (const site of sites) {
      if (text.includes(site)) {
        bad(`${path.replace(`${process.cwd()}/`, "")}: contains the campaign-foundry string ${JSON.stringify(site)}`);
      }
    }
  }
  say(`sites: ${sites.length} campaign-foundry strings, none present in ${files.length} generic file(s)`);
}

function checkMemory(memoryDir, lessonsPath, allowlistPath) {
  let files;
  try {
    files = readdirSync(memoryDir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return fail(`cannot read memory directory: ${memoryDir}`);
  }
  const lessons = readFile(lessonsPath, "lessons file");
  const allowlist = new Set(
    readFile(allowlistPath, "allowlist")
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => line.trim()),
  );
  for (const name of files) {
    const cited = lessons.split("\n").some((line) => line.trim() === `source: ${name}`);
    if (!cited && !allowlist.has(name)) {
      bad(
        `memory file ${name} is neither cited with a "source: ${name}" line in ${lessonsPath.replace(`${process.cwd()}/`, "")} ` +
          `nor listed in ${allowlistPath.replace(`${process.cwd()}/`, "")} with a reason`,
      );
    }
  }
  const citedCount = files.filter((name) =>
    lessons.split("\n").some((line) => line.trim() === `source: ${name}`),
  ).length;
  say(`memory: ${files.length} files, ${citedCount} cited, ${allowlist.size} allowlisted`);
}

function checkTokenReview(reviewPath, genericDir, sourceDir, hexagenRoot) {
  const reviewed = new Map();
  for (const line of readFile(reviewPath, "token review").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) {
      bad(`${reviewPath}: "${line.slice(0, 60)}" has no tab, so it carries no reason`);
      continue;
    }
    const token = collapse(line.slice(0, tab));
    const reason = line.slice(tab + 1).trim();
    if (!reason) {
      bad(`${reviewPath}: ${JSON.stringify(token)} has an empty reason`);
      continue;
    }
    reviewed.set(token, reason);
  }

  const sourceText = walk(sourceDir)
    .map((path) => readFile(path, `file in source ${sourceDir}`))
    .join("\n");
  const tokens = new Set();
  for (const path of walk(genericDir)) {
    const text = readFile(path, `file in generic tree ${genericDir}`);
    for (const token of [...codeSpans(text), ...fencedWords(text)]) tokens.add(collapse(token));
  }

  // The tracked-hexagen corpus, read once. This is the same question `git grep -F -e <token> --`
  // asks — does this fixed string occur in any tracked file outside the fixture and
  // docs/planning/ — and it is asked that way for speed. One `git grep` process per token is
  // minutes of wall clock for the few hundred tokens a scrubbed skill produces, which is a test
  // suite nobody runs twice. One `git ls-files`, one read of each file, one substring test per
  // token. Binary files are skipped, as git grep skips them.
  const excluded = [
    "packages/template-engine/__tests__/fixtures/orchestration/",
    "docs/planning/",
  ];
  let tracked;
  try {
    tracked = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--", ".", ...excluded.map((p) => `:(exclude)${p}`)],
      { cwd: hexagenRoot, encoding: "utf8", maxBuffer: 1 << 28 },
    );
  } catch (error) {
    return fail(`cannot list tracked files under ${hexagenRoot}: ${error.message}`);
  }
  let corpus = "";
  for (const relative of tracked.split("\0")) {
    if (!relative || relative.startsWith(excluded[0]) || relative.startsWith(excluded[1])) {
      continue;
    }
    let text;
    try {
      text = readFileSync(join(hexagenRoot, relative), "utf8");
    } catch {
      continue;
    }
    if (text.includes(" ")) continue;
    corpus += `\n${text}`;
  }

  const unaccounted = [];
  for (const token of tokens) {
    if (!sourceText.includes(token)) continue;
    if (!corpus.includes(token) && !reviewed.has(token)) unaccounted.push(token);
  }
  for (const token of unaccounted) {
    bad(
      `${JSON.stringify(token)} appears in the generic skill and in the pinned snapshot, and in no ` +
        `other tracked hexagen file — it needs a line and a reason in ${reviewPath.replace(`${process.cwd()}/`, "")}`,
    );
  }
  say(
    `tokens: ${tokens.size} distinct in the generic skill, ${reviewed.size} reviewed, ` +
      `${unaccounted.length} unaccounted`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sourceDir = resolve(opts.source);
  const allowlistEntries = new Set(
    readFile(opts.allowlist, "allowlist")
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => line.trim()),
  );

  const trees = opts.trees.map((dir) => readTree(resolve(dir)));
  const treeLines = new Set();
  const treeContent = new Set();
  for (const tree of trees) {
    for (const line of tree.lines) treeLines.add(line);
    for (const unit of tree.content) treeContent.add(unit);
  }

  const totals = { anchors: 0, content: 0 };
  for (const { name, path: relative } of UNIT_FILES) {
    const path = join(sourceDir, relative);
    const text = readFile(path, `source file ${name}`);
    const counts = checkCounts(name, text);

    for (const anchor of anchorUnits(text, EXPECTED_UNITS[name].boldLeads)) {
      totals.anchors++;
      if (!treeLines.has(collapse(anchor))) {
        bad(`${name} anchor uncovered: ${JSON.stringify(collapse(anchor).slice(0, 100))}`);
      }
    }
    for (const unit of contentUnits(text)) {
      totals.content++;
      if (!treeContent.has(collapse(unit))) {
        bad(`${name} paragraph uncovered: ${JSON.stringify(collapse(unit).slice(0, 100))}`);
      }
    }
    say(`${name}: ${counts.anchors} anchors, ${counts.content} paragraphs, both asserted`);
  }

  // The allowlist covers memory files only. A source unit may never be allowlisted: if one cannot
  // be preserved that is a stop-and-report to the owner, not a line in a text file. A paragraph
  // that genuinely has nowhere to live has to be visible, not excusable.
  const sourceUnits = new Set();
  for (const { path: relative } of UNIT_FILES) {
    const text = readFileSync(join(sourceDir, relative), "utf8");
    for (const line of text.split("\n")) sourceUnits.add(collapse(line));
    for (const unit of contentUnits(text)) sourceUnits.add(collapse(unit));
  }
  for (const entry of allowlistEntries) {
    if (sourceUnits.has(collapse(entry))) {
      bad(
        `allowlist entry ${JSON.stringify(entry)} is a unit of the pinned snapshot. The allowlist ` +
          `covers memory files only — a source unit that cannot be preserved is a stop-and-report.`,
      );
    }
  }

  if (opts.sites) checkSites(resolve(opts.sites), resolve(opts.generic));
  if (opts.memory) checkMemory(resolve(opts.memory), resolve(opts.lessons), resolve(opts.allowlist));
  if (opts.tokenReview) {
    checkTokenReview(
      resolve(opts.tokenReview),
      resolve(opts.generic),
      sourceDir,
      resolve(opts.hexagenRoot),
    );
  }

  say(`totals: ${totals.anchors} anchors, ${totals.content} paragraphs, over ${trees.length} tree(s)`);
  if (failures > 0) {
    say(`UNCOVERED: ${failures} finding(s)`);
    process.exit(1);
  }
  say("clean: every anchor and every paragraph of the snapshot survives somewhere");
  process.exit(0);
}

main();
