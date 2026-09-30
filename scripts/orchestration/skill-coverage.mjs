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
//     --allowlist <file> [--sites <file> --generic <dir>] [--memory <dir>] [--memory-manifest <file>] [--lessons <file>]
//     [--token-review <file>] [--hexagen-root <dir>]

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The unit counts at the pin, keyed by the snapshot file's path relative to --source. Asserted,
// not documented: if the extractor changes shape and starts seeing fewer units, that is a
// regression in the check and has to fail loudly.
//
// `anchorKinds` is the per-file anchor rule, stated as data rather than left to an implicit
// branch: which kinds of line count as an anchor in that file. SKILL.md anchors on headings AND
// bold-lead lines (9 headings + 62 bold leads = 71). rationale.md and cast.md anchor on their
// `#`/`##`/`###` headings ONLY: 1 + 7 + 37 = 45 and 1 + 15 + 19 = 35. Those are the counts the
// plan enumerates per file and the counts the test asserts.
//
// Nothing is checked less for it. In both of those files every bold-lead line is the *first* line
// of a paragraph, so the content tier already requires that exact line to survive verbatim; an
// anchor unit for it would be a second copy of a requirement the content tier is already
// enforcing. The anchor tier earns its place in SKILL.md because a heading there is its own unit,
// separate from the paragraph beneath it.
const EXPECTED_UNITS = {
  "SKILL.md": { path: "SKILL.md", anchors: 71, content: 86, anchorKinds: ["heading", "boldLead"] },
  "rationale.md": { path: "references/rationale.md", anchors: 45, content: 98, anchorKinds: ["heading"] },
  "cast.md": { path: "references/cast.md", anchors: 35, content: 145, anchorKinds: ["heading"] },
};

// The snapshot files the two tiers are computed over. `gate.sh` and `wave-event.sh` are
// snapshots too, but they are machinery rather than prose: the shim's fix is to *stop* climbing
// four directories, so there is nothing in it to preserve verbatim.
const UNIT_FILES = Object.entries(EXPECTED_UNITS).map(([name, spec]) => ({ name, ...spec }));

/**
 * The one place that knows what a fence is. CommonMark: an opener is up to three spaces, then a run
 * of three or more backticks or tildes (a backtick fence's info string may not contain a backtick).
 * It closes only on a line of the SAME character, at least as long as the opener, followed by
 * nothing but whitespace — so a ``` followed by text inside a ```bash fence is content, not a close.
 *
 * `open` is null outside a fence, or {char, length} inside one. Returns the next state and what the
 * line was: "open", "close", or "body" (inside a fence, not a closer), or null (outside, no fence).
 */
function stepFence(line, open) {
  if (open) {
    const closer = line.match(/^ {0,3}(`+|~+)\s*$/);
    if (closer && closer[1][0] === open.char && closer[1].length >= open.length) {
      return { open: null, event: "close" };
    }
    return { open, event: "body" };
  }
  const opener = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (opener && !(opener[1][0] === "`" && opener[2].includes("`"))) {
    return { open: { char: opener[1][0], length: opener[1].length }, event: "open" };
  }
  return { open: null, event: null };
}

const HEADING = /^\s{0,3}#{1,6}\s/;
const BOLD_LEAD = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\*\*/;

// `collapse` belongs to the content tier only. Anchors are whole-line equality on `trim()`: a
// heading whose inner spacing changed is a different line, and collapsing it would let
// `## Current  seats` stand in for `## Current seats`.
const collapse = (text) => text.replace(/\s+/g, " ").trim();

// An unreadable directory at any depth is a bad path (exit 2), never an uncaught exception.
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return fail(`cannot read directory: ${dir}`);
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let isDirectory;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      return fail(`cannot stat: ${path}`);
    }
    if (isDirectory) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Paragraphs and fenced blocks, in order. Fences are returned whole, delimiters included. */
export function contentUnits(text) {
  const units = [];
  let paragraph = [];
  let open = null;
  const flush = () => {
    if (paragraph.length) units.push(paragraph.join("\n"));
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.event === "open") {
      flush();
      paragraph = [line];
      continue;
    }
    if (step.event === "close") {
      paragraph.push(line);
      flush();
      continue;
    }
    if (step.event === "body") {
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
export function anchorUnits(text, anchorKinds) {
  const headings = anchorKinds.includes("heading");
  const boldLeads = anchorKinds.includes("boldLead");
  const anchors = [];
  let open = null;
  for (const line of text.split("\n")) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.event) continue;
    if ((headings && HEADING.test(line)) || (boldLeads && BOLD_LEAD.test(line))) anchors.push(line);
  }
  return anchors;
}

/**
 * Inline code spans: one matched backtick run, the interior whole, one surrounding space stripped.
 * Spans are looked for paragraph by paragraph and never inside a fenced block, as in CommonMark:
 * a span cannot cross a blank line, and the backtick run of a fence delimiter is not a span
 * delimiter. (Fenced blocks are covered by `fencedWords`.)
 */
function codeSpans(text) {
  const spans = [];
  for (const unit of contentUnits(text)) {
    if (stepFence(unit.split("\n")[0], null).event === "open") continue;
    spans.push(...spansIn(unit));
  }
  return spans;
}

function spansIn(text) {
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
export function fencedWords(text) {
  const words = [];
  let open = null;
  for (const line of text.split("\n")) {
    const step = stepFence(line, open);
    open = step.open;
    if (step.event !== "body") continue;
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
    "--memory-manifest",
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
  if (!opts.lessons !== !(opts.memory || opts.memoryManifest)) {
    fail("--lessons goes with --memory and/or --memory-manifest, and needs one of them");
  }
  if (opts.tokenReview && !opts.generic) {
    fail("--token-review also needs --generic (and --sites), so the sweep knows which tree to read");
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
    for (const line of text.split("\n")) lines.add(line.trim());
    for (const unit of contentUnits(text)) content.add(collapse(unit));
  }
  return { lines, content, files: entries };
}

/**
 * The snapshot is only evidence if it is still the pinned bytes. SOURCE.md records the git blob id
 * of each file at the pin; recompute each blob id here (sha1 over "blob <bytes>\0<bytes>", which is
 * what `git hash-object` prints) and compare. Counting units is not enough: a one-byte edit keeps
 * every count.
 */
function checkSnapshot(sourceDir) {
  const recorded = new Map();
  const row = /^\|\s*`[^`]+`\s*\|\s*`([0-9a-f]{40})`\s*\|\s*`([^`]+)`\s*\|/;
  for (const line of readFile(join(sourceDir, "SOURCE.md"), "SOURCE.md").split("\n")) {
    const match = line.match(row);
    if (match) recorded.set(match[2], match[1]);
  }
  if (recorded.size === 0) {
    bad("SOURCE.md records no blob ids, so the snapshot cannot be proven to be the pinned bytes");
  }
  for (const [dest, blob] of recorded) {
    let bytes;
    try {
      bytes = readFileSync(join(sourceDir, dest));
    } catch {
      return fail(`cannot read source/${dest}, which SOURCE.md records`);
    }
    const actual = createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (actual !== blob) {
      bad(`source/${dest} is not the pinned snapshot: its blob id is ${actual}, SOURCE.md records ${blob}`);
    }
  }
  for (const { path } of UNIT_FILES) {
    if (!recorded.has(path)) bad(`source/${path} has no blob id recorded in SOURCE.md`);
  }
  say(`snapshot: ${recorded.size} file(s) match the blob ids recorded in SOURCE.md`);
}

/**
 * Allowlist entries, each with the reason above it. An entry is a non-comment line; its reason is
 * the block of `#` lines directly above it, with no blank line between. A bare entry is a failure:
 * "not relevant" is not a reason, and no reason at all cannot be reviewed.
 */
function parseAllowlist(path) {
  const entries = new Map();
  let block = 0;
  for (const raw of readFile(path, "allowlist").split("\n")) {
    const line = raw.trim();
    if (line === "") block = 0;
    else if (line.startsWith("#")) block++;
    else {
      entries.set(line, block > 0);
      block = 0;
    }
  }
  return entries;
}

function checkCounts(name, sourceText) {
  const expected = EXPECTED_UNITS[name];
  const anchors = anchorUnits(sourceText, expected.anchorKinds).length;
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
  // A check over nothing passes vacuously, which is the failure this whole script exists to refuse.
  if (sites.length === 0) bad(`sites: ${sitesPath} lists no strings, so the ban checks nothing`);
  if (files.length === 0) bad(`sites: the generic tree ${genericDir} has no files, so nothing was checked`);
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

function checkMemory(memoryDir, manifestPath, lessonsPath, allowlistPath) {
  // The manifest is the memory directory's file NAMES, committed, so CI (which has no memory
  // directory) can run the classification. The live directory, when given, is the source of truth
  // for what exists: the two must agree. With no directory, the manifest is what is classified.
  const rel = (path) => path.replace(`${process.cwd()}/`, "");
  let manifest = null;
  if (manifestPath) {
    manifest = readFile(manifestPath, "memory manifest")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .sort();
  }
  let files = manifest;
  if (memoryDir) {
    try {
      files = readdirSync(memoryDir).filter((name) => name.endsWith(".md")).sort();
    } catch {
      return fail(`cannot read memory directory: ${memoryDir}`);
    }
    if (manifest) {
      const live = new Set(files);
      const listed = new Set(manifest);
      for (const name of files) {
        if (!listed.has(name)) {
          bad(`memory file ${name} is in the memory directory but not in the manifest ${rel(manifestPath)}`);
        }
      }
      for (const name of manifest) {
        if (!live.has(name)) {
          bad(`memory file ${name} is in the manifest ${rel(manifestPath)} but not in the memory directory`);
        }
      }
    }
  }
  // Classify the union, so a name present on only one side is still held to the cited-or-allowlisted rule.
  files = [...new Set([...files, ...(manifest ?? [])])].sort();
  const lessons = readFile(lessonsPath, "lessons file");
  const allowlist = new Set(parseAllowlist(allowlistPath).keys());
  if (files.length === 0) {
    bad("memory: no memory files to classify, so nothing was checked (an empty manifest or directory)");
  }
  // An allowlist entry for a file that is not classified is stale: it excuses nothing, and would
  // silently excuse a file of that name if one appeared.
  const classified = new Set(files);
  for (const entry of allowlist) {
    if (!classified.has(entry)) {
      bad(`allowlist entry ${JSON.stringify(entry)} is not one of the ${files.length} classified memory files`);
    }
  }
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
    // One line per token, so an internal newline is written as the two characters \n, and a
    // literal backslash as \\. Nothing else is touched: the token is the RAW span interior.
    const token = line.slice(0, tab).replace(/\\(n|\\)/g, (_, c) => (c === "n" ? "\n" : "\\"));
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
    for (const token of [...codeSpans(text), ...fencedWords(text)]) tokens.add(token);
  }

  // The tracked-hexagen corpus, read once. This is the same question `git grep -F -e <token> --`
  // asks — does this fixed string occur in any tracked file outside the fixture, the template's own
  // copy of the skill, and docs/planning/ — and it is asked that way for speed. One `git grep`
  // process per token is minutes of wall clock for the few hundred tokens a scrubbed skill produces,
  // which is a test suite nobody runs twice. One `git ls-files`, one read of each file, one
  // substring test per token. Binary files are skipped, as git grep skips them.
  //
  // THREE excluded prefixes, and the third is why the filter below cannot be two
  // hard-coded startsWith calls. The template's `files/.agents/skills/orchestrate-wave/**` IS a
  // tracked file that IS the generic tree being swept: since OW4 moved the skill into the template
  // it is both the subject of the check and a member of the corpus, so every one of its tokens
  // occurs "somewhere else" and the sweep would match everything, flagging nothing. That is not a
  // cosmetic wart: F16's red case (a span planted in source and generic with no review line) then
  // passes VACUOUSLY, because the planted token is "found" in the template copy of itself.
  // Excluded here so the question keeps its meaning: is this token in some OTHER tracked hexagen
  // file?
  const excluded = [
    "packages/template-engine/__tests__/fixtures/orchestration/",
    "packages/template-engine/templates/orchestration/files/.agents/skills/orchestrate-wave/",
    "docs/planning/",
    // The generated bundle embeds the skill's text verbatim, so it is the skill again, not a second
    // place a token lives. Left in the corpus, every skill-only token would be "found" in it.
    "packages/template-engine/src/infrastructure/generated/template-bundle.generated.ts",
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
    if (!relative || excluded.some((p) => relative.startsWith(p))) {
      continue;
    }
    let text;
    try {
      text = readFileSync(join(hexagenRoot, relative), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    corpus += `\n${text}`;
  }

  if (tokens.size === 0) {
    bad(`tokens: the generic tree ${genericDir} yielded no code spans and no fenced words, so the sweep checked nothing`);
  }
  if (corpus.trim() === "") {
    bad(`tokens: no tracked hexagen file was readable under ${hexagenRoot}, so "in no other file" holds vacuously`);
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
  const allowlist = parseAllowlist(opts.allowlist);
  const allowlistEntries = new Set(allowlist.keys());
  for (const [entry, hasReason] of allowlist) {
    if (!hasReason) {
      bad(
        `allowlist entry ${JSON.stringify(entry)} has no reason: it needs a block of # comment lines ` +
          `directly above it, with no blank line between`,
      );
    }
  }

  const trees = opts.trees.map((dir) => readTree(resolve(dir)));
  const treeLines = new Set();
  const treeContent = new Set();
  for (const tree of trees) {
    for (const line of tree.lines) treeLines.add(line);
    for (const unit of tree.content) treeContent.add(unit);
  }

  checkSnapshot(sourceDir);

  const totals = { anchors: 0, content: 0 };
  for (const { name, path: relative } of UNIT_FILES) {
    const path = join(sourceDir, relative);
    const text = readFile(path, `source file ${name}`);
    const counts = checkCounts(name, text);

    for (const anchor of anchorUnits(text, EXPECTED_UNITS[name].anchorKinds)) {
      totals.anchors++;
      if (!treeLines.has(anchor.trim())) {
        bad(`${name} anchor uncovered: ${JSON.stringify(anchor.trim().slice(0, 100))}`);
      }
    }
    for (const unit of contentUnits(text)) {
      totals.content++;
      if (!treeContent.has(collapse(unit))) {
        bad(`${name} paragraph uncovered: ${JSON.stringify(collapse(unit).slice(0, 100))}`);
      }
    }
    say(
      `${name}: ${counts.anchors} anchors [${EXPECTED_UNITS[name].anchorKinds.join(", ")}], ` +
        `${counts.content} paragraphs, both asserted`,
    );
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
  if (opts.lessons) {
    checkMemory(
      opts.memory && resolve(opts.memory),
      opts.memoryManifest && resolve(opts.memoryManifest),
      resolve(opts.lessons),
      resolve(opts.allowlist),
    );
  }
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

// Run only as a script, so the unit extractors can be imported and tested on their own.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
