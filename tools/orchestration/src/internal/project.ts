import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_RELATIVE_PATH,
  loadConfig,
  parseConfig,
  type Config,
} from "./config.js";

/**
 * Locating the project, and the `gh` fallback, for the bins that need both.
 *
 * A bin must work when it is invoked from anywhere inside a project — a hook
 * runs it from the repo root, an operator runs it from a subdirectory, and CI
 * runs it with a working directory nobody chose. So the root is found by
 * walking UP for the overlay or a `.git`, never by assuming the cwd.
 *
 * `repo` is the one setting that can need the outside world. It comes from
 * `gh repo view`, and `gh` failing is not this module's problem to solve: the
 * config loader leaves `repo` absent and `doctor` is what reports it. A bin
 * that needs `repo` and has none says so itself.
 */

/** The package's own root, so the walk-up can be started from a real path. */
const PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** True for a directory that holds the project marker. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The project root, found by walking up from `start` (default: the cwd).
 *
 * `.git` is the marker. It is a directory in a normal clone and a FILE in a
 * worktree, so both are accepted — this package is developed in worktrees, and
 * a root finder that only understood one of them would report the wrong
 * directory there.
 */
export async function findRepositoryRoot(
  start: string = process.cwd(),
): Promise<string> {
  let current = resolve(start);
  for (;;) {
    if (
      (await isFile(join(current, ".git"))) ||
      (await isDirectory(join(current, ".git")))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // No `.git` anywhere above the cwd. Fall back to the nearest ancestor holding
  // the overlay, and finally to the cwd, so a bin still reports a path rather
  // than refusing outright.
  current = resolve(start);
  for (;;) {
    if (await isFile(join(current, CONFIG_RELATIVE_PATH))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

/** `gh repo view --json nameWithOwner`, or `undefined` when it cannot answer. */
export function readRepositoryFromGh(
  cwd: string = process.cwd(),
): string | undefined {
  try {
    const out = execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(out) as { nameWithOwner?: unknown };
    return typeof parsed.nameWithOwner === "string"
      ? parsed.nameWithOwner
      : undefined;
  } catch {
    return undefined;
  }
}

/** The overlay's path inside a project root. */
export function configPath(root: string): string {
  return join(root, CONFIG_RELATIVE_PATH);
}

/** Every default, for a project with no overlay at all. */
export async function emptyConfigFor(root: string): Promise<Config> {
  return (
    await loadConfig({
      readConfig: async () => undefined,
      repo: async () => readRepositoryFromGh(root),
    })
  ).config!;
}

/**
 * The project's configuration.
 *
 * A MISSING overlay is not an error here: `emptyConfigFor` semantics, with
 * `repo` still derived from `gh`. A MISSING or INVALID one is reported through
 * `problems`, and the bins that care (`doctor`) read those. A bin that merely
 * needs a setting reads the defaulted config and does not second-guess it —
 * except `repo`, which it must have.
 */
export async function loadConfigFor(root: string = process.cwd()): Promise<{
  readonly root: string;
  readonly config: Config;
  readonly present: boolean;
  readonly problems: readonly {
    readonly at: string;
    readonly message: string;
  }[];
}> {
  const path = configPath(root);
  let text: string | undefined;
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = undefined;
  }

  if (text === undefined) {
    return {
      root,
      config: await emptyConfigFor(root),
      present: false,
      problems: [],
    };
  }

  const parsed = parseConfig(text);
  if (parsed.config === undefined) {
    // Invalid: give the caller the problems, and a defaulted config so a bin
    // that only needs `planDir` still runs and says something useful.
    return {
      root,
      config: await emptyConfigFor(root),
      present: true,
      problems: parsed.problems,
    };
  }

  const config =
    parsed.config.repo !== undefined
      ? parsed.config
      : {
          ...parsed.config,
          ...(await repoFromGh(root)),
        };
  return { root, config, present: true, problems: parsed.problems };
}

async function repoFromGh(root: string): Promise<{ repo?: string }> {
  const repo = readRepositoryFromGh(root);
  return repo !== undefined ? { repo } : {};
}

/** Convenience for a bin that wants the project root and nothing else. */
export { PACKAGE_ROOT };
