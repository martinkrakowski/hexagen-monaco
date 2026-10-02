/* eslint-disable no-console */
import { Command, InvalidArgumentError } from "commander";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  BROWNFIELD_SCHEMA_VERSION,
  ObservedReport,
  normalizeSlicePath,
} from "@hexagen/shared";
import {
  ensureExcluded,
  GitExcludeError,
  realpathOfExistingAncestor,
  resolveExcludeFile,
} from "../shared/git-exclude.js";
import { globToRegExp } from "../shared/glob.js";
import { parseIgnoreLine, verdict, type IgnoreRule } from "../shared/ignore.js";
import {
  DEFAULT_MAX_IMPORT_BYTES,
  DEFAULT_MAX_IMPORT_FILES,
  DEFAULT_MAX_IMPORT_MS,
  READ_EXTENSIONS,
  runImportPass,
} from "./imports/pass.js";
import { samePath } from "./same-path.js";
import { timeCapReason, walk, type WalkResult } from "./walk.js";

/**
 * `hexagen observe`: a read-only scan that reports what a repo already
 * contains, in the repo's own names. It never calls adopt, bootstrap, sync or
 * hexagen-lint, and the only thing it can write is `--out`, which must
 * resolve under `<root>/.hexagen/`.
 *
 * The import pass (`edges`, `unresolved`) is a bounded lexical scan of
 * JS/TS files; see `./imports/`.
 */

export const DEFAULT_MAX_FILES = 50_000;
export const DEFAULT_MAX_MS = 30_000;
export {
  DEFAULT_MAX_IMPORT_BYTES,
  DEFAULT_MAX_IMPORT_FILES,
  DEFAULT_MAX_IMPORT_MS,
};

type Section<T> =
  | { collected: true; items: T[] }
  | { collected: false; reason: string };

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  swift: "Swift",
  sh: "Shell",
  bash: "Shell",
  vue: "Vue",
  svelte: "Svelte",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "CSS",
  less: "CSS",
};

function languageOf(file: string): string | undefined {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return LANGUAGES[base.slice(dot + 1).toLowerCase()];
}

const BUILD_MARKERS: ReadonlySet<string> = new Set([
  "package.json",
  "nx.json",
  "turbo.json",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "pyproject.toml",
  "Makefile",
]);

function isBuildMarker(base: string): boolean {
  return BUILD_MARKERS.has(base) || base.startsWith("build.gradle");
}

function extOf(file: string): string {
  return file.slice(file.lastIndexOf(".") + 1).toLowerCase();
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

export interface ObserveOptions {
  root: string;
  /** `--dont-touch` prefixes, reported as given. */
  dontTouch?: string[];
  maxFiles?: number;
  maxMs?: number;
  /** Import pass caps; the pass has its own clock, started when it begins. */
  maxImportFiles?: number;
  maxImportBytes?: number;
  maxImportMs?: number;
  /** Clock seam for the time cap. */
  now?: () => number;
}

/**
 * Remove credentials, query and fragment from a URL remote. scp-like remotes
 * (`git@host:o/r`) are not URLs and go through the regex fallback.
 */
function stripCredentials(remote: string): string {
  if (!remote.includes("://")) {
    // scp-like `[user[:pass]@]host:path`: only the plain `git` user is kept.
    const scp = /^([^@/]+)@([^/:]+:.*)$/.exec(remote);
    return scp && scp[1] !== "git" ? (scp[2] as string) : remote;
  }
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1");
  }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }).trim();
  } catch {
    return null;
  }
}

export class ObserveError extends Error {}

function realNative(p: string): string {
  try {
    return realpathSync.native(path.resolve(p));
  } catch {
    throw new ObserveError(`--root ${p} does not exist or is not accessible`);
  }
}

function readRepo(root: string): { remote?: string; commit: string } {
  realNative(root);
  const commit = git(root, ["rev-parse", "HEAD"]);
  if (!commit) {
    throw new ObserveError(
      `${root} is not a git checkout with at least one commit; observe records the commit it read`,
    );
  }
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (!top || !samePath(realNative(top), realNative(root))) {
    throw new ObserveError(
      `--root must be the repo top level (git says ${top ?? "unknown"})`,
    );
  }
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  return remote ? { remote: stripCredentials(remote), commit } : { commit };
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read a metadata file under `root`, refusing to read through a symlink: each
 * path component is `lstat`ed, matching the walk's no-symlink policy. A link
 * is recorded as a note and the file treated as absent.
 */
async function readMeta(
  root: string,
  rel: string,
  notes: string[],
): Promise<string | null> {
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        notes.push(`note: ${rel} is a symlink; not read`);
        return null;
      }
    } catch {
      return null; // absent
    }
  }
  return readText(current);
}

function normalizeWorkspaceGlob(raw: string): string {
  return raw.replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Workspace exclusions (`!glob`) declared by pnpm-workspace.yaml or the root
 * package.json `workspaces` (array or `{packages}` form). Include globs add
 * nothing the walk has not already found, since every non-skipped
 * package.json is a package, so only exclusions change the result.
 */
async function workspaceExclusions(
  root: string,
  notes: string[],
): Promise<RegExp[]> {
  const patterns: string[] = [];
  const pkgText = await readMeta(root, "package.json", notes);
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { workspaces?: unknown };
      const ws = pkg.workspaces;
      const list = Array.isArray(ws)
        ? ws
        : ws && typeof ws === "object"
          ? (ws as { packages?: unknown }).packages
          : undefined;
      if (Array.isArray(list)) {
        patterns.push(
          ...list.filter((p): p is string => typeof p === "string"),
        );
      }
    } catch {
      notes.push("note: root package.json is not valid JSON");
    }
  }
  const pnpmText = await readMeta(root, "pnpm-workspace.yaml", notes);
  if (pnpmText) {
    try {
      const doc = yaml.load(pnpmText) as { packages?: unknown } | null;
      if (doc && Array.isArray(doc.packages)) {
        patterns.push(
          ...doc.packages.filter((p): p is string => typeof p === "string"),
        );
      }
    } catch {
      notes.push("note: pnpm-workspace.yaml is not valid YAML");
    }
  }
  const out: RegExp[] = [];
  for (const p of patterns.filter((q) => q.startsWith("!"))) {
    const re = globToRegExp(normalizeWorkspaceGlob(p.slice(1)));
    if (re) out.push(re);
    else
      notes.push(
        `note: workspace pattern ${JSON.stringify(p)} is invalid; skipped`,
      );
  }
  return out;
}

async function collectPackages(
  root: string,
  files: readonly string[],
  notes: string[],
  declared?: Set<string>,
): Promise<Section<{ name: string; root: string; manifestFile: string }>> {
  const exclusions = await workspaceExclusions(root, notes);
  const items: { name: string; root: string; manifestFile: string }[] = [];
  for (const file of files) {
    if (baseName(file) !== "package.json") continue;
    const dir =
      file === "package.json" ? "." : file.slice(0, -"/package.json".length);
    if (dir !== "." && exclusions.some((re) => re.test(dir))) continue;
    const text = await readMeta(root, file, notes);
    let name: string | undefined;
    try {
      const parsed = JSON.parse(text ?? "") as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.length > 0) {
        name = parsed.name;
      }
    } catch {
      notes.push(`note: ${file} is not valid JSON; package skipped`);
      continue;
    }
    // BW0's format needs a non-empty name. A manifest with no name gets the
    // repo's own directory name: the directory path, or the root directory's
    // basename for ".". Nothing is made up beyond what is on disk.
    const fallback =
      dir === "." ? path.basename(path.resolve(root)) || "root" : dir;
    if (name !== undefined) declared?.add(file);
    if (name === undefined) {
      notes.push(`note: ${file} has no name; reported under its directory`);
    }
    items.push({ name: name ?? fallback, root: dir, manifestFile: file });
  }
  items.sort((a, b) =>
    a.root === b.root
      ? 0
      : a.root === "."
        ? -1
        : b.root === "."
          ? 1
          : a.root < b.root
            ? -1
            : 1,
  );
  return { collected: true, items };
}

function collectLanguages(files: readonly string[]): Section<{
  name: string;
  fileCount: number;
}> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const lang = languageOf(file);
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const items = [...counts].map(([name, fileCount]) => ({ name, fileCount }));
  items.sort((a, b) => b.fileCount - a.fileCount || (a.name < b.name ? -1 : 1));
  return { collected: true, items };
}

function collectBuild(
  files: readonly string[],
): Section<{ marker: string; path: string }> {
  const items = files
    .filter((f) => isBuildMarker(baseName(f)))
    .map((f) => ({ marker: baseName(f), path: f }));
  return { collected: true, items };
}

/** `.gitattributes` rules for `linguist-generated`, in file order. */
function linguistRules(text: string, notes: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const [pattern, ...attrs] = trimmed.split(/\s+/);
    if (!pattern) continue;
    let decision: boolean | undefined;
    for (const attr of attrs) {
      if (attr === "linguist-generated" || attr === "linguist-generated=true") {
        decision = true;
      } else if (
        attr === "-linguist-generated" ||
        attr === "!linguist-generated" ||
        attr === "linguist-generated=false"
      ) {
        decision = false;
      }
    }
    if (decision === undefined) continue;
    const rule = parseIgnoreLine(pattern, !decision, notes, ".gitattributes");
    if (rule) rules.push(rule);
  }
  return rules;
}

async function hasGeneratedHeader(abs: string): Promise<boolean> {
  let handle;
  try {
    handle = await fs.open(abs, "r");
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    return head.split("\n", 5).some((line) => /@generated\b/.test(line));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function collectGenerated(
  root: string,
  tree: WalkResult,
  now: () => number,
  start: number,
  maxMs: number,
  notes: string[],
): Promise<
  Section<{
    path: string;
    source: "linguist-generated" | "header" | "gitignored-build-dir";
  }>
> {
  type Item = {
    path: string;
    source: "linguist-generated" | "header" | "gitignored-build-dir";
  };
  const found = new Map<string, Item>();

  const attrText = await readMeta(root, ".gitattributes", notes);
  if (attrText) {
    const rules = linguistRules(attrText, notes);
    const entries = [
      ...tree.dirs.map((p) => ({ p, dir: true })),
      ...tree.files.map((p) => ({ p, dir: false })),
    ].sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
    const emittedDirs: string[] = [];
    for (const { p, dir } of entries) {
      if (emittedDirs.some((d) => p.startsWith(d))) continue;
      if (verdict(rules, p, dir) === true) {
        const out = dir ? `${p}/` : p;
        if (dir) emittedDirs.push(out);
        found.set(out, { path: out, source: "linguist-generated" });
      }
    }
  }

  for (const dir of tree.ignoredBuildDirs) {
    found.set(dir, { path: dir, source: "gitignored-build-dir" });
  }

  const candidates = tree.files.filter(
    (f) => languageOf(f) !== undefined && !found.has(f),
  );
  const BATCH = 64;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const hits = await Promise.all(
      batch.map((f) => hasGeneratedHeader(path.join(root, f))),
    );
    batch.forEach((f, idx) => {
      if (hits[idx]) found.set(f, { path: f, source: "header" });
    });
    // Checked after every batch, the last included.
    if (now() - start > maxMs) {
      return { collected: false, reason: timeCapReason(maxMs) };
    }
  }
  const items = [...found.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { collected: true, items };
}

async function isDirectory(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function collectDontTouch(
  root: string,
  flagPaths: readonly string[],
  notes: string[],
): Promise<
  Section<{ path: string; source: "flag" | "codeowners"; owner?: string }>
> {
  type Item = { path: string; source: "flag" | "codeowners"; owner?: string };
  const items: Item[] = [];

  for (const raw of flagPaths) {
    const cleaned = raw.replace(/^\.\//, "");
    const norm = normalizeSlicePath(cleaned);
    if (!norm.ok) {
      throw new ObserveError(`--dont-touch "${raw}": ${norm.reason}`);
    }
    const withSlash =
      !cleaned.endsWith("/") && (await isDirectory(path.join(root, cleaned)))
        ? `${cleaned}/`
        : cleaned;
    items.push({ path: withSlash, source: "flag" });
  }

  let codeowners: string | null = null;
  for (const rel of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    codeowners = await readMeta(root, rel, notes);
    if (codeowners !== null) break;
  }
  if (codeowners !== null) {
    const byPath = new Map<string, Item>();
    let skipped = 0;
    for (const line of codeowners.split("\n")) {
      const trimmed = line.replace(/\s+#.*$/, "").trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const [pattern, ...owners] = trimmed.split(/\s+/);
      if (!pattern || owners.length === 0) continue;
      const literal = !/[*?[\]\\!]/.test(pattern);
      const body = pattern.replace(/\/$/, "");
      const anchored = pattern.startsWith("/") || body.includes("/");
      const rel = pattern.replace(/^\//, "");
      if (!literal || !anchored || rel === "" || !normalizeSlicePath(rel).ok) {
        skipped += 1;
        continue;
      }
      const asPath =
        !rel.endsWith("/") && (await isDirectory(path.join(root, rel)))
          ? `${rel}/`
          : rel;
      byPath.set(asPath, {
        path: asPath,
        source: "codeowners",
        owner: owners.join(" "),
      });
    }
    items.push(...byPath.values());
    if (skipped > 0) {
      notes.push(
        `note: ${skipped} CODEOWNERS pattern(s) are globs or unanchored names and cannot be reported as paths; skipped`,
      );
    }
  }
  return { collected: true, items };
}

export async function observe(
  options: ObserveOptions,
): Promise<ObservedReport> {
  const root = path.resolve(options.root);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const now = options.now ?? Date.now;
  const repo = readRepo(root);
  const notes: string[] = [];
  // A bad flag fails fast, before the clock starts.
  for (const raw of options.dontTouch ?? []) {
    const check = normalizeSlicePath(raw.replace(/^\.\//, ""));
    if (!check.ok) {
      throw new ObserveError(`--dont-touch "${raw}": ${check.reason}`);
    }
  }
  // The deadline covers metadata collection, the walk and the header pass.
  const start = now();
  const dontTouch = await collectDontTouch(
    root,
    options.dontTouch ?? [],
    notes,
  );

  const tree = await walk(root, { maxFiles, maxMs, now, start });
  notes.unshift(...tree.notes);
  const truncatedReason = tree.truncated;
  const notCollected = <T>(): Section<T> => ({
    collected: false,
    reason: truncatedReason ?? "walk did not complete",
  });

  const declaredManifests = new Set<string>();
  const packages = truncatedReason
    ? notCollected<{ name: string; root: string; manifestFile: string }>()
    : await collectPackages(root, tree.files, notes, declaredManifests);

  const unreadLanguages = [
    ...new Set(
      tree.files
        .filter((f) => languageOf(f) !== undefined)
        .map(extOf)
        .filter((e) => !READ_EXTENSIONS.has(e)),
    ),
  ].sort();
  const walkReason = truncatedReason ?? "walk did not complete";
  let edges: ObservedReport["edges"] = {
    collected: false,
    reason: walkReason,
  };
  let unresolved: ObservedReport["unresolved"] = {
    collected: false,
    reason: walkReason,
  };
  let importPassReason: string | null = null;
  if (!truncatedReason && packages.collected) {
    // Only packages that declare a name can be imported by it.
    const named = packages.items
      .filter((p) => declaredManifests.has(p.manifestFile))
      .map((p) => ({ name: p.name, root: p.root }));
    const pass = await runImportPass({
      root,
      files: tree.files,
      packages: named,
      maxFiles: options.maxImportFiles ?? DEFAULT_MAX_IMPORT_FILES,
      maxBytes: options.maxImportBytes ?? DEFAULT_MAX_IMPORT_BYTES,
      maxMs: options.maxImportMs ?? DEFAULT_MAX_IMPORT_MS,
      now,
      start: now(),
      notes,
    });
    if (pass.collected) {
      edges = { collected: true, unreadLanguages, items: pass.edges };
      unresolved = { collected: true, items: pass.unresolved };
    } else {
      importPassReason = pass.reason;
      edges = { collected: false, reason: pass.reason };
      unresolved = { collected: false, reason: pass.reason };
    }
  }

  const report = {
    schemaVersion: BROWNFIELD_SCHEMA_VERSION,
    repo,
    generatedAt: new Date().toISOString(),
    packages,
    languages: truncatedReason ? notCollected() : collectLanguages(tree.files),
    build: truncatedReason ? notCollected() : collectBuild(tree.files),
    generated: truncatedReason
      ? notCollected()
      : await collectGenerated(root, tree, now, start, maxMs, notes),
    dontTouch,
    edges,
    unresolved,
    limits: { truncated: false, reasons: [] as string[], maxFiles },
  };

  const generated = report.generated;
  if (truncatedReason) {
    report.limits.truncated = true;
    report.limits.reasons.push(truncatedReason);
  } else if (!generated.collected) {
    report.limits.truncated = true;
    report.limits.reasons.push(generated.reason);
  }
  if (importPassReason) {
    report.limits.truncated = true;
    report.limits.reasons.push(importPassReason);
  }
  // `note:` lines are observations, not truncation; `truncated` stays false.
  const MAX_NOTES = 50;
  report.limits.reasons.push(...notes.slice(0, MAX_NOTES));
  if (notes.length > MAX_NOTES) {
    report.limits.reasons.push(
      `note: ${notes.length - MAX_NOTES} more note(s) omitted`,
    );
  }
  return ObservedReport.parse(report);
}

export interface RunObserveOptions extends ObserveOptions {
  out?: string;
  yes?: boolean;
  /** Test seam: the temp file path for a given target. */
  tmpPath?: (target: string) => string;
}

export interface RunObserveResult {
  exitCode: number;
  /** The report JSON, when it is meant for stdout. */
  stdout?: string;
  /** Preflight and error lines, in order, for stderr. */
  messages: string[];
}

/**
 * Resolve `--out` against the root and require it to land strictly under
 * `<root>/.hexagen/`, including through symlinks. Returns the absolute path.
 */
async function resolveOut(root: string, out: string): Promise<string | null> {
  if (out.endsWith("/") || out.endsWith(path.sep)) return null;
  const abs = path.resolve(root, out);
  const sidecar = path.join(root, ".hexagen");
  const rel = path.relative(sidecar, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const realRoot = await fs.realpath(root);
  const realTarget = await realpathOfExistingAncestor(abs);
  const realRel = path.relative(path.join(realRoot, ".hexagen"), realTarget);
  if (realRel === "" || realRel.startsWith("..") || path.isAbsolute(realRel)) {
    return null;
  }
  return abs;
}

/** Why a path is not a usable `.hexagen` directory, or null when it is fine. */
async function sidecarProblem(root: string): Promise<string | null> {
  try {
    const st = await fs.stat(path.join(root, ".hexagen"));
    return st.isDirectory()
      ? null
      : `${path.join(root, ".hexagen")} exists and is not a directory`;
  } catch {
    return null; // absent: it will be created
  }
}

export async function runObserve(
  options: RunObserveOptions,
): Promise<RunObserveResult> {
  const root = path.resolve(options.root);
  const messages: string[] = [];
  let target: string | null = null;
  let excludeFile: string | null = null;

  try {
    realNative(root); // a missing root is a clear exit 2 before anything else
    if (options.out !== undefined) {
      target = await resolveOut(root, options.out);
      if (!target) {
        messages.push(
          `--out must name a file under ${path.join(root, ".hexagen")}${path.sep}; got "${options.out}"`,
        );
        return { exitCode: 2, messages };
      }
      const problem = await sidecarProblem(root);
      if (problem) {
        messages.push(problem);
        return { exitCode: 2, messages };
      }
      readRepo(root); // --root must be the top level before anything is promised
      excludeFile = await resolveExcludeFile(root);
      messages.push(`will write: ${target}`);
      messages.push(`will write: ${excludeFile}`);
      messages.push(
        "note: .hexagen/ is excluded through the exclude file above, not .gitignore; `git add -f` can still stage it.",
      );
      if (!options.yes) {
        messages.push("Re-run with --yes to write it.");
        return { exitCode: 2, messages };
      }
    }

    const report = await observe(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (!target) return { exitCode: 0, stdout: json, messages };

    // The exclude is updated first: if it fails, no observed.json exists.
    await ensureExcluded(root, ".hexagen/");
    const tmp =
      options.tmpPath?.(target) ??
      `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    // True only once this run created the temp file, so cleanup can never
    // remove something it did not make (a directory, or someone's file).
    let created = false;
    // The check-then-rename window can only be raced by another process in the
    // FDE's own clone, which is outside this tool's threat model.
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const handle = await fs.open(tmp, "wx");
      created = true;
      try {
        await handle.writeFile(json, "utf8");
      } finally {
        await handle.close();
      }
      await fs.rename(tmp, target);
    } catch (e) {
      if (created) {
        // Best effort: never masks the original error.
        await fs.unlink(tmp).catch(() => undefined);
      }
      messages.push(
        `could not write ${target}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { exitCode: 2, messages };
    }
    return { exitCode: 0, messages };
  } catch (e) {
    if (
      e instanceof ObserveError ||
      e instanceof GitExcludeError ||
      (e instanceof Error && e.name === "ZodError")
    ) {
      messages.push(e.message);
      return { exitCode: 2, messages };
    }
    throw e;
  }
}

function parsePositiveInt(name: string): (v: string) => number {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive integer`);
    }
    return n;
  };
}

export const observeCommander = new Command("observe")
  .description(
    "Read-only scan of a repo: packages, languages, build markers, generated paths. Prints observed JSON to stdout, or writes it under .hexagen/ with --out",
  )
  .option("--root <dir>", "Repo root (defaults to cwd; never searched upward)")
  .option(
    "--out <file>",
    "Write the report here; must resolve under <root>/.hexagen/ (requires --yes)",
  )
  .option("--yes", "Confirm the write named by the `will write:` line")
  .option(
    "--dont-touch <prefix...>",
    "Repo-relative paths to report as dontTouch (reported only, never a rule)",
  )
  .option(
    "--max-files <n>",
    `Stop the walk after this many files (default ${DEFAULT_MAX_FILES})`,
    parsePositiveInt("--max-files"),
  )
  .option(
    "--max-ms <n>",
    `Stop the walk after this many milliseconds (default ${DEFAULT_MAX_MS})`,
    parsePositiveInt("--max-ms"),
  )
  .option(
    "--max-import-files <n>",
    `Import pass: stop after this many JS/TS files (default ${DEFAULT_MAX_IMPORT_FILES})`,
    parsePositiveInt("--max-import-files"),
  )
  .option(
    "--max-import-bytes <n>",
    `Import pass: stop after reading this many bytes (default ${DEFAULT_MAX_IMPORT_BYTES})`,
    parsePositiveInt("--max-import-bytes"),
  )
  .option(
    "--max-import-ms <n>",
    `Import pass: stop after this many milliseconds (default ${DEFAULT_MAX_IMPORT_MS})`,
    parsePositiveInt("--max-import-ms"),
  )
  .action(
    async (opts: {
      root?: string;
      out?: string;
      yes?: boolean;
      dontTouch?: string[];
      maxFiles?: number;
      maxMs?: number;
      maxImportFiles?: number;
      maxImportBytes?: number;
      maxImportMs?: number;
    }) => {
      const result = await runObserve({
        root: opts.root ?? process.cwd(),
        out: opts.out,
        yes: opts.yes,
        dontTouch: opts.dontTouch,
        maxFiles: opts.maxFiles,
        maxMs: opts.maxMs,
        maxImportFiles: opts.maxImportFiles,
        maxImportBytes: opts.maxImportBytes,
        maxImportMs: opts.maxImportMs,
      });
      for (const line of result.messages) console.error(line);
      if (result.stdout !== undefined) process.stdout.write(result.stdout);
      process.exitCode = result.exitCode;
    },
  );
