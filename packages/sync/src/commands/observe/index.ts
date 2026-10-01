/* eslint-disable no-console */
import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  BROWNFIELD_SCHEMA_VERSION,
  ObservedReport,
  normalizeSlicePath,
} from "@hexagen/shared";
import { globToRegExp } from "./glob.js";
import { parseIgnoreLine, verdict, type IgnoreRule } from "./ignore.js";
import { timeCapReason, walk, type WalkResult } from "./walk.js";

/**
 * `hexagen observe`: a read-only scan that reports what a repo already
 * contains, in the repo's own names. It never calls adopt, bootstrap, sync or
 * hexagen-lint, and the only thing it can write is `--out`, which must
 * resolve under `<root>/.hexagen/`.
 *
 * The import pass (`edges`, `unresolved`) is a separate lane (BW4b); here
 * both sections are reported as not collected.
 */

export const DEFAULT_MAX_FILES = 50_000;
export const DEFAULT_MAX_MS = 30_000;
const IMPORT_PASS_PENDING = "import pass not run (BW4b)";

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

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

export interface ObserveOptions {
  root: string;
  /** `--dont-touch` prefixes, reported as given. */
  dontTouch?: string[];
  maxFiles?: number;
  maxMs?: number;
  /** Clock seam for the time cap. */
  now?: () => number;
}

/** Remove `user:password@` from a URL-style remote. */
function stripCredentials(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1");
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

function readRepo(root: string): { remote?: string; commit: string } {
  const commit = git(root, ["rev-parse", "HEAD"]);
  if (!commit) {
    throw new ObserveError(
      `${root} is not a git checkout with at least one commit; observe records the commit it read`,
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
  const pkgText = await readText(path.join(root, "package.json"));
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
  const pnpmText = await readText(path.join(root, "pnpm-workspace.yaml"));
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
  return patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => globToRegExp(normalizeWorkspaceGlob(p.slice(1))));
}

async function collectPackages(
  root: string,
  files: readonly string[],
  notes: string[],
): Promise<Section<{ name: string; root: string; manifestFile: string }>> {
  const exclusions = await workspaceExclusions(root, notes);
  const items: { name: string; root: string; manifestFile: string }[] = [];
  for (const file of files) {
    if (baseName(file) !== "package.json") continue;
    const dir =
      file === "package.json" ? "." : file.slice(0, -"/package.json".length);
    if (dir !== "." && exclusions.some((re) => re.test(dir))) continue;
    const text = await readText(path.join(root, file));
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
function linguistRules(text: string): IgnoreRule[] {
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
    const rule = parseIgnoreLine(pattern, !decision);
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

  const attrText = await readText(path.join(root, ".gitattributes"));
  if (attrText) {
    const rules = linguistRules(attrText);
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
    if (now() - start > maxMs) {
      return { collected: false, reason: timeCapReason(maxMs) };
    }
    const batch = candidates.slice(i, i + BATCH);
    const hits = await Promise.all(
      batch.map((f) => hasGeneratedHeader(path.join(root, f))),
    );
    batch.forEach((f, idx) => {
      if (hits[idx]) found.set(f, { path: f, source: "header" });
    });
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
  for (const rel of ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]) {
    codeowners = await readText(path.join(root, rel));
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
  const start = now();
  const repo = readRepo(root);
  const notes: string[] = [];

  const tree = await walk(root, { maxFiles, maxMs, now });
  const truncatedReason = tree.truncated;
  const notCollected = <T>(): Section<T> => ({
    collected: false,
    reason: truncatedReason ?? "walk did not complete",
  });

  const dontTouch = await collectDontTouch(
    root,
    options.dontTouch ?? [],
    notes,
  );

  const report = {
    schemaVersion: BROWNFIELD_SCHEMA_VERSION,
    repo,
    generatedAt: new Date().toISOString(),
    packages: truncatedReason
      ? notCollected()
      : await collectPackages(root, tree.files, notes),
    languages: truncatedReason ? notCollected() : collectLanguages(tree.files),
    build: truncatedReason ? notCollected() : collectBuild(tree.files),
    generated: truncatedReason
      ? notCollected()
      : await collectGenerated(root, tree, now, start, maxMs),
    dontTouch,
    edges: { collected: false as const, reason: IMPORT_PASS_PENDING },
    unresolved: { collected: false as const, reason: IMPORT_PASS_PENDING },
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
  report.limits.reasons.push(...notes);
  return ObservedReport.parse(report);
}

export interface RunObserveOptions extends ObserveOptions {
  out?: string;
  yes?: boolean;
}

export interface RunObserveResult {
  exitCode: number;
  /** The report JSON, when it is meant for stdout. */
  stdout?: string;
  /** Preflight and error lines, in order, for stderr. */
  messages: string[];
}

/** The nearest existing ancestor of `p`, resolved through symlinks. */
async function realpathOfExistingAncestor(p: string): Promise<string> {
  let current = p;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, path.relative(current, p));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return p;
      current = parent;
    }
  }
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

export async function runObserve(
  options: RunObserveOptions,
): Promise<RunObserveResult> {
  const root = path.resolve(options.root);
  const messages: string[] = [];
  let target: string | null = null;

  if (options.out !== undefined) {
    target = await resolveOut(root, options.out);
    if (!target) {
      messages.push(
        `--out must name a file under ${path.join(root, ".hexagen")}${path.sep}; got "${options.out}"`,
      );
      return { exitCode: 2, messages };
    }
    messages.push(`will write: ${target}`);
    if (!options.yes) {
      messages.push("Re-run with --yes to write it.");
      return { exitCode: 2, messages };
    }
  }

  let report: ObservedReport;
  try {
    report = await observe(options);
  } catch (e) {
    if (e instanceof ObserveError) {
      messages.push(e.message);
      return { exitCode: 2, messages };
    }
    throw e;
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;

  if (!target) return { exitCode: 0, stdout: json, messages };

  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, target);
  return { exitCode: 0, messages };
}

function parsePositiveInt(name: string): (v: string) => number {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ObserveError(`${name} must be a positive integer`);
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
  .action(
    async (opts: {
      root?: string;
      out?: string;
      yes?: boolean;
      dontTouch?: string[];
      maxFiles?: number;
      maxMs?: number;
    }) => {
      const result = await runObserve({
        root: opts.root ?? process.cwd(),
        out: opts.out,
        yes: opts.yes,
        dontTouch: opts.dontTouch,
        maxFiles: opts.maxFiles,
        maxMs: opts.maxMs,
      });
      for (const line of result.messages) console.error(line);
      if (result.stdout !== undefined) process.stdout.write(result.stdout);
      process.exitCode = result.exitCode;
    },
  );
