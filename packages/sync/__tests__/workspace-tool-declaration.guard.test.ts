import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    if (NOT_A_PACKAGE_BIN.has(bin)) continue;
    bins.push(bin);
  }
  return bins;
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
