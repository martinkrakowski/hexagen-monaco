import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWorkflowRunCommands } from "./helpers/workflow-run-commands.js";

/**
 * Repo-wide guard: a workspace that invokes a binary from its own `scripts`
 * must DECLARE that binary as its own dependency.
 *
 * Why this exists. `vitest` was invoked by 35 workspace `test` scripts while
 * being declared by none of them — it resolved only because Turbo injects the
 * root `node_modules/.bin` into `PATH`. The documented command
 * (`yarn workspace <pkg> test`, AGENTS.md §Commands) therefore failed for every
 * one of them, and the whole suite hung on one runner's PATH behaviour.
 *
 * That is the same class as the arch-linter bin gap (AUD-010, #452): a tool
 * resolved by ambient convention rather than declaration, working in exactly one
 * invocation path and silently failing in the others. Two instances in one month
 * is why this is a checked invariant rather than a convention.
 *
 * Scope note: this checks DECLARATION, not version agreement. Range alignment
 * across workspaces is a separate concern (see the T5 `yarn constraints` item in
 * docs/planning/2026-08-15-workspace-tool-dependency-plan.md); asserting it here
 * would conflate two failures with different fixes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * Workspace globs, read from the root `package.json` — the single source of
 * truth. Mirroring them here would let a newly added pattern (`services/*`)
 * be skipped silently, which in a completeness guard is the worst failure mode:
 * it would keep passing while checking less.
 *
 * Only the `<dir>/*` shape this repo uses is supported. Anything else throws
 * rather than being partially scanned — an unsupported pattern must be a loud
 * failure, not a quiet gap.
 */
async function workspacePatterns(): Promise<string[]> {
  const raw = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(pkg.workspaces)
    ? pkg.workspaces
    : (pkg.workspaces?.packages ?? []);
  assert.ok(
    patterns.length > 0,
    "root package.json declares no workspaces — this guard would check nothing",
  );
  const unsupported = patterns.filter((p) => !/^[^/*]+\/\*$/.test(p));
  assert.deepEqual(
    unsupported,
    [],
    `Unsupported workspace pattern(s): ${unsupported.join(", ")}. ` +
      `This guard only expands "<dir>/*". Teach it the new shape rather than ` +
      `letting those workspaces go unchecked.`,
  );
  return patterns;
}

/**
 * Commands that are not package binaries and so cannot be declared. Shell
 * builtins and coreutils only — anything that resolves from `node_modules/.bin`
 * belongs in the assertion, not here.
 */
const NOT_A_PACKAGE_BIN = new Set([
  "node",
  "npm",
  "npx",
  "yarn",
  "corepack",
  "echo",
  "true",
  "false",
  "cd",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "test",
  "exit",
  "sh",
  "bash",
  "cat",
  "sed",
  "grep",
  "find",
  "chmod",
  "docker",
  "git",
  "python3",
  // Shell grammar — not binaries. Needed once this guard reads .sh / workflow
  // `run:` lines rather than only package.json script strings.
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "select",
  "function",
  "time",
  "[[",
  "[",
  "]",
  "]]",
  "!",
  "declare",
  "local",
  "return",
  "trap",
  "read",
  "source",
  "set",
  "unset",
  "export",
  "shift",
  "getopts",
  "wait",
  // Host / CI tools. Not node_modules bins; cannot be declared in package.json.
  "awk",
  "printf",
  "command",
  "type",
  "curl",
  "wget",
  "tar",
  "gzip",
  "ssh",
  "scp",
  "sudo",
  "tee",
  "xargs",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "tr",
  "cut",
  "date",
  "sleep",
  "kill",
  "env",
  "uname",
  "dirname",
  "basename",
  "readlink",
  "realpath",
  "mktemp",
  "ln",
  "touch",
  "stat",
  "cmp",
  "diff",
  "jq",
  "yq",
  "kubectl",
  "helm",
  "gh",
  "sha256sum",
  "md5sum",
  "envsubst",
  "actionlint",
  "continue",
  "break",
  "next",
]);

/**
 * Known-bad package bins for the `.sh` path only (`shellSource: true`).
 *
 * A full declared-bin floor on bash sources is not viable: awk programs,
 * function names, and `git` subcommands after `$(...)` look like first tokens.
 * Measured when this guard first grew. Workflow `run:` steps and lint-staged
 * use the open root-declared floor instead.
 *
 * Add a name here when an audit finds a new undeclared package bin in `scripts/*.sh`.
 * Do not treat this set as the workflow floor.
 */
const UNDECLARED_PACKAGE_BINS = new Set([
  "mocha",
  "jest",
  "jest-cli",
  "webpack",
  "rollup",
  "esbuild",
  "nx",
  "pnpm",
  "bun",
  "gulp",
  "grunt",
]);

/**
 * `turbo` is root orchestration: it is invoked from the ROOT package.json to run
 * workspace scripts, never from a workspace's own scripts. If a workspace ever
 * calls it, that is a real finding and this allow-list should NOT be widened to
 * hide it.
 */
const ROOT_ONLY_ORCHESTRATION = new Set(["turbo"]);

type Workspace = {
  dir: string;
  name: string;
  scripts: Record<string, string>;
  declared: Set<string>;
};

/**
 * The bin names a package provides, read from its own `bin` field.
 *
 * Resolved rather than assumed: a binary's name routinely differs from its
 * package's (`tsc` ships from `typescript`, `next` from `next`, `vitest` from
 * `vitest`). Hard-coding a bin→package table would be a second source of truth
 * that drifts — the same mistake #452 fixed in the arch-linter resolver, which
 * now reads the installed package's `bin` field instead of assuming a path.
 *
 * Looks in the workspace's own `node_modules` first, then the hoisted root.
 * Returns an empty set when the package is not installed; callers fall back to
 * matching on the package name, so a missing install degrades to the weaker
 * check rather than a false accusation.
 */
/**
 * Cache keyed by the RESOLVED manifest path, not by `(workspace, dep)`. Almost
 * every dependency hoists to the root copy, so keying on the resolved path is
 * what actually shares work across workspaces — a composite key would cache
 * each of ~40 workspaces separately and save nothing.
 */
const binCache = new Map<string, Set<string>>();

async function binsProvidedBy(
  dep: string,
  workspaceDir: string,
): Promise<Set<string>> {
  const candidates = [
    path.join(REPO_ROOT, workspaceDir, "node_modules", dep, "package.json"),
    path.join(REPO_ROOT, "node_modules", dep, "package.json"),
  ];
  for (const candidate of candidates) {
    const cached = binCache.get(candidate);
    if (cached) return cached;
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue; // not installed here; try the hoisted copy
    }
    const pkg = JSON.parse(raw) as { bin?: string | Record<string, string> };
    const bins =
      typeof pkg.bin === "string"
        ? new Set([dep])
        : pkg.bin && typeof pkg.bin === "object"
          ? new Set(Object.keys(pkg.bin))
          : new Set<string>();
    binCache.set(candidate, bins);
    return bins;
  }
  return new Set();
}

/** Every bin name reachable from a workspace's declared dependencies. */
async function declaredBins(ws: Workspace): Promise<Set<string>> {
  const bins = new Set<string>();
  for (const dep of ws.declared) {
    // A dependency always satisfies an invocation of its own name.
    bins.add(dep);
    for (const bin of await binsProvidedBy(dep, ws.dir)) bins.add(bin);
  }
  return bins;
}

async function readWorkspaces(): Promise<Workspace[]> {
  const found: Workspace[] = [];
  for (const pattern of await workspacePatterns()) {
    const group = pattern.slice(0, -2); // "packages/*" -> "packages"
    const groupDir = path.join(REPO_ROOT, group);
    let entries: string[];
    try {
      entries = await fs.readdir(groupDir);
    } catch {
      assert.fail(
        `workspace pattern "${pattern}" points at ${group}/, which does not exist`,
      );
    }
    const before = found.length;
    for (const entry of entries) {
      const dir = path.join(groupDir, entry);
      const manifestPath = path.join(dir, "package.json");
      let raw: string;
      try {
        raw = await fs.readFile(manifestPath, "utf8");
      } catch {
        continue; // not a workspace (stray directory)
      }
      const pkg = JSON.parse(raw) as {
        name?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      found.push({
        dir: path.relative(REPO_ROOT, dir),
        name: pkg.name ?? path.relative(REPO_ROOT, dir),
        scripts: pkg.scripts ?? {},
        declared: new Set([
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
          ...Object.keys(pkg.peerDependencies ?? {}),
        ]),
      });
    }
    assert.ok(
      found.length > before,
      `workspace pattern "${pattern}" matched no packages — either it is dead ` +
        `and should be removed from root package.json, or discovery is broken`,
    );
  }
  return found;
}

/**
 * The binary a shell command invokes, or null when there is nothing to check.
 *
 * Handles the shapes actually present in this repo: leading `VAR=value` env
 * assignments, `&&`/`||`/`;` chains, and pipes. Each segment is checked, because
 * `build && vitest run` hides the same bug as a bare `vitest run`.
 */
function invokedBinaries(command: string): string[] {
  const bins: string[] = [];
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    const bin = tokens[i];
    if (!bin) continue;
    // Path-ish invocations (./scripts/x.sh, dist/cli.js) are files, not bins.
    if (bin.includes("/") || bin.includes("\\")) continue;
    if (bin.startsWith("$") || bin.startsWith("`") || bin.startsWith("("))
      continue;
    if (NOT_A_PACKAGE_BIN.has(bin)) continue;
    bins.push(bin);
  }
  return bins;
}

async function walkFiles(
  dir: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const found: string[] = [];
  const visit = async (current: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isFile() && predicate(entry.name)) found.push(absolute);
    }
  };
  await visit(dir);
  return found;
}

const rel = (absolute: string) =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

/** Shell functions defined in a file so their later calls are not bins. */
function definedFunctions(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(
    /^(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  )) {
    names.add(match[1]);
  }
  return names;
}

function commandLinesFromShell(source: string): string[] {
  const logical: string[] = [];
  let buffer = "";
  for (const line of source.split("\n")) {
    const continued = /\\$/.test(line);
    const piece = continued ? line.slice(0, -1) : line;
    buffer = buffer ? `${buffer} ${piece.trim()}` : piece;
    if (!continued) {
      logical.push(buffer);
      buffer = "";
    }
  }
  if (buffer) logical.push(buffer);
  return logical.flatMap((line) => {
    const withoutComment = line.replace(/(^|\s)#.*$/, "$1");
    const trimmed = withoutComment.trim();
    if (!trimmed) return [];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) return [];
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)/.test(trimmed)) return [];
    if (/^function\s+/.test(trimmed)) return [];
    return [trimmed];
  });
}

/**
 * Package-bin invocations in a script or workflow `run:` line.
 *
 * Stricter than `invokedBinaries`: does not split on a bare `|` / `;` inside
 * ANSI color assignments, ignores flags and punctuation, and only accepts a
 * token that could be an npm bin name.
 */
function invokedRootBins(command: string): string[] {
  const bins: string[] = [];
  // Newlines are operators here: a `run: |` block is one string with
  // one command per line. Unspaced `;` is a real shell separator; tokens
  // that fail the package-bin shape (ANSI fragments after `;31m`) are dropped.
  for (const segment of command.split(
    /\s*(?:&&|\|\|)\s*|[\n;]|\s*\|\s*|\s+&\s+/,
  )) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
    const bin = tokens[i];
    if (!bin) continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(bin)) continue;
    if (NOT_A_PACKAGE_BIN.has(bin)) continue;
    bins.push(bin);
  }
  return bins;
}

function lintStagedCommands(pkg: { "lint-staged"?: unknown }): string[] {
  const cfg = pkg["lint-staged"];
  if (!cfg || typeof cfg !== "object") return [];
  const commands: string[] = [];
  for (const value of Object.values(cfg as Record<string, unknown>)) {
    if (typeof value === "string") commands.push(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") commands.push(entry);
      }
    }
  }
  return commands;
}

function nodeSpawnedCommands(source: string): string[] {
  // Floor, not a JS AST: the three call shapes this repo's scripts/ actually
  // use. `exec(`, `spawn(`, and multi-arg `spawnSync("mocha", …)` are not
  // scanned — add a pattern if an audit finds one.
  const commands: string[] = [];
  const patterns = [
    /spawnSync\(\s*["']([^"']+)["']/g,
    /execSync\(\s*["'`]([^"'`]+)["'`]/g,
    /\bsh\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) commands.push(match[1]);
  }
  return commands;
}

async function rootWorkspace(): Promise<Workspace> {
  const raw = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    dir: ".",
    name: pkg.name ?? "hexagen-monaco",
    scripts: pkg.scripts ?? {},
    declared: new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]),
  };
}

function undeclaredInCommands(
  commands: string[],
  available: Set<string>,
  skip: Set<string>,
  locator: string,
  opts: { shellSource?: boolean } = {},
): string[] {
  const violations: string[] = [];
  for (const command of commands) {
    for (const bin of invokedRootBins(command)) {
      if (skip.has(bin)) continue;
      if (
        opts.shellSource &&
        !available.has(bin) &&
        !UNDECLARED_PACKAGE_BINS.has(bin)
      ) {
        continue;
      }
      if (!available.has(bin)) {
        violations.push(
          `${locator} invokes "${bin}" but no root dependency provides it`,
        );
      }
    }
  }
  return violations;
}

describe("workspace tool declaration", () => {
  it("every binary a workspace script invokes is declared by that workspace", async () => {
    const workspaces = await readWorkspaces();
    // Discovery is proven by readWorkspaces() itself: every pattern in the root
    // manifest is expanded, an unsupported shape throws, and a pattern matching
    // nothing fails. A magic-number floor is deliberately NOT used — it would
    // both miss a newly added pattern and break on a legitimate consolidation.
    // Anchor on a workspace that must exist for this test to be running at all.
    assert.ok(
      workspaces.some((ws) => ws.dir === path.join("packages", "sync")),
      `discovery did not find packages/sync, the package this guard lives in — ` +
        `found ${workspaces.length}: ${workspaces.map((w) => w.dir).join(", ")}`,
    );

    const violations: string[] = [];
    for (const ws of workspaces) {
      const available = await declaredBins(ws);
      for (const [scriptName, command] of Object.entries(ws.scripts)) {
        for (const bin of invokedBinaries(command)) {
          if (ROOT_ONLY_ORCHESTRATION.has(bin)) {
            violations.push(
              `${ws.dir}: script "${scriptName}" invokes root-only orchestration "${bin}"`,
            );
            continue;
          }
          if (!available.has(bin)) {
            violations.push(
              `${ws.dir}: script "${scriptName}" invokes "${bin}" but no declared dependency provides it`,
            );
          }
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Workspaces must declare the binaries their scripts invoke.\n` +
        `Relying on hoisting means the script only works under a runner that injects the\n` +
        `root node_modules/.bin (Turbo), and fails under \`yarn workspace <pkg> <script>\`.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });
});

describe("root lint-staged, scripts/, and workflow tool declaration (T4.3 / T4.4)", () => {
  it("extracts workflow run steps and ignores uses: actions", () => {
    const source = [
      "jobs:",
      "  lint:",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: one-liner",
      "        run: eslint --fix",
      "      - name: block",
      "        run: |",
      "          yarn install --immutable",
      "          mocha --ci",
      "      - name: quoted",
      "        run: 'prettier --write .'",
      "      - name: indented-block",
      "        run: |2",
      "            mocha --ci",
    ].join("\n");
    assert.deepEqual(extractWorkflowRunCommands(source), [
      "eslint --fix",
      "yarn install --immutable\nmocha --ci",
      "prettier --write .",
      "  mocha --ci",
    ]);
  });

  it("flags an undeclared package bin and ignores yarn / host tools", () => {
    const available = new Set(["eslint", "prettier"]);
    const skip = new Set<string>();
    assert.deepEqual(
      undeclaredInCommands(
        ["eslint --fix", "yarn mocha --ci", "npx jest", "curl -sSfL"],
        available,
        skip,
        "fixture",
      ),
      [],
    );
    assert.deepEqual(
      undeclaredInCommands(["mocha --ci"], available, skip, "fixture.yml"),
      ['fixture.yml invokes "mocha" but no root dependency provides it'],
    );
  });

  it("flags mocha on a later line of a run: | block", () => {
    const source = [
      "jobs:",
      "  lint:",
      "    steps:",
      "      - run: |",
      "          yarn install --immutable",
      "          mocha --ci",
    ].join("\n");
    const available = new Set(["eslint", "prettier"]);
    const violations = undeclaredInCommands(
      extractWorkflowRunCommands(source),
      available,
      new Set(),
      "fixture.yml",
    );
    assert.deepEqual(violations, [
      'fixture.yml invokes "mocha" but no root dependency provides it',
    ]);
  });

  it("flags mocha after an unspaced semicolon", () => {
    const available = new Set(["eslint"]);
    assert.deepEqual(
      undeclaredInCommands(
        ["echo ready;mocha --ci"],
        available,
        new Set(),
        "fixture.yml",
      ),
      ['fixture.yml invokes "mocha" but no root dependency provides it'],
    );
  });

  it("every lint-staged command is a declared root package bin", async () => {
    const raw = await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { "lint-staged"?: unknown };
    const commands = lintStagedCommands(pkg);
    assert.ok(
      commands.length > 0,
      "root package.json has no lint-staged commands — this guard would check nothing",
    );
    const root = await rootWorkspace();
    const available = await declaredBins(root);
    const violations = undeclaredInCommands(
      commands,
      available,
      new Set(),
      "package.json lint-staged",
    );
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("undeclared binaries in scripts/ and .github/workflows fail", async () => {
    const scriptFiles = await walkFiles(
      path.join(REPO_ROOT, "scripts"),
      (name) => /\.(sh|js|mjs|cjs|ts)$/.test(name),
    );
    const workflowFiles = await walkFiles(
      path.join(REPO_ROOT, ".github", "workflows"),
      (name) => /\.ya?ml$/.test(name),
    );
    assert.ok(
      scriptFiles.some(
        (file) => rel(file) === "scripts/validate-ui-boundary.sh",
      ),
      `scripts/ discovery found ${scriptFiles.length} files and missed validate-ui-boundary.sh`,
    );
    assert.ok(
      workflowFiles.some((file) => rel(file) === ".github/workflows/lint.yml"),
      `workflow discovery found ${workflowFiles.length} files and missed lint.yml`,
    );

    const root = await rootWorkspace();
    const available = await declaredBins(root);
    const violations: string[] = [];

    for (const file of scriptFiles) {
      const source = await fs.readFile(file, "utf8");
      const skip = definedFunctions(source);
      const locator = rel(file);
      if (/\.sh$/.test(file)) {
        violations.push(
          ...undeclaredInCommands(
            commandLinesFromShell(source),
            available,
            skip,
            locator,
            { shellSource: true },
          ),
        );
      } else {
        violations.push(
          ...undeclaredInCommands(
            nodeSpawnedCommands(source),
            available,
            skip,
            locator,
          ),
        );
      }
    }

    for (const file of workflowFiles) {
      const source = await fs.readFile(file, "utf8");
      violations.push(
        ...undeclaredInCommands(
          extractWorkflowRunCommands(source),
          available,
          new Set(),
          rel(file),
        ),
      );
    }

    assert.deepEqual(
      violations,
      [],
      `Root-owned scripts and workflows must invoke declared package bins ` +
        `(or an allow-listed host/CI tool), not ambient runner PATH.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });
});
