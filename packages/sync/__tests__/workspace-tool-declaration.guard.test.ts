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

/** Workspace globs, mirrored from the root package.json `workspaces` field. */
const WORKSPACE_DIRS = ["apps", "packages", "tools"];

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
async function binsProvidedBy(
  dep: string,
  workspaceDir: string,
): Promise<Set<string>> {
  const candidates = [
    path.join(REPO_ROOT, workspaceDir, "node_modules", dep, "package.json"),
    path.join(REPO_ROOT, "node_modules", dep, "package.json"),
  ];
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const pkg = JSON.parse(raw) as { bin?: string | Record<string, string> };
    if (typeof pkg.bin === "string") return new Set([dep]);
    if (pkg.bin && typeof pkg.bin === "object")
      return new Set(Object.keys(pkg.bin));
    return new Set();
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
  for (const group of WORKSPACE_DIRS) {
    const groupDir = path.join(REPO_ROOT, group);
    let entries: string[];
    try {
      entries = await fs.readdir(groupDir);
    } catch {
      continue;
    }
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
    assert.ok(
      workspaces.length > 30,
      `expected to discover the monorepo's workspaces, found ${workspaces.length}`,
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
