import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_RELATIVE_PATH,
  loadConfig,
  type Config,
  type ConfigProblem,
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

/** The collaborators `loadConfigFor` needs from outside, so a test can supply `gh`. */
export interface ProjectDeps {
  /** `owner/name` as `gh` reports it (unvalidated), or `undefined`. */
  readonly readRepository?: (cwd: string) => string | undefined;
}

/**
 * Every default, for a project with no overlay at all, WITH the problems
 * resolving it raised (a `gh` answer that is not `owner/name`). Callers must
 * carry those problems; keeping only `.config` silently discards them.
 */
export async function emptyConfigFor(
  root: string,
  deps: ProjectDeps = {},
): Promise<{
  readonly config: Config;
  readonly problems: readonly ConfigProblem[];
}> {
  const read = deps.readRepository ?? readRepositoryFromGh;
  const result = await loadConfig({
    readConfig: async () => undefined,
    repo: async () => read(root),
  });
  return { config: result.config!, problems: result.problems };
}

/**
 * The project's configuration.
 *
 * A MISSING overlay is not an error here: `emptyConfigFor` semantics, with
 * `repo` still derived from `gh`. An INVALID one is reported through
 * `problems` — including a `repo` that `gh` answered with something that is not
 * `owner/name`.
 *
 * `config` is ALWAYS present on the result, and a field that failed validation
 * holds its default. That is exactly why the contract is refuse-or-report: a bin
 * that acts on the result (writes, verifies, scaffolds) must, when `present` is
 * true and `problems` is not empty, exit 2, print every problem and write
 * nothing (`configRefusal` builds that text). Only a diagnostic bin (`doctor`)
 * prints the problems and carries on. A bin that needs `repo` and has none says
 * so itself.
 */
export async function loadConfigFor(
  rootArg?: string,
  deps: ProjectDeps = {},
): Promise<{
  readonly root: string;
  readonly config: Config;
  readonly present: boolean;
  readonly problems: readonly {
    readonly at: string;
    readonly message: string;
  }[];
}> {
  // Start from the repository root, never the cwd: an operator runs a bin from
  // a subdirectory as often as from the top, and a bin that read the overlay
  // relative to wherever it happened to be started would report "no overlay"
  // (or scaffold a second one) from any directory but one.
  const root = rootArg ?? (await findRepositoryRoot());
  const read = deps.readRepository ?? readRepositoryFromGh;
  let text: string | undefined;
  let unreadable: ConfigProblem | undefined;
  try {
    text = await readFile(configPath(root), "utf8");
  } catch (err) {
    // ONLY ENOENT means "no overlay". A permission error, or a directory sitting
    // at the config path, means the overlay EXISTS and cannot be read; treating
    // that as absent would let every bin skip `configRefusal` and run on defaults.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      unreadable = {
        at: "<file>",
        message: `could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    text = undefined;
  }

  if (unreadable !== undefined) {
    const fallback = await emptyConfigFor(root, deps);
    return {
      root,
      config: fallback.config,
      present: true,
      problems: [unreadable, ...fallback.problems],
    };
  }

  // One implementation of "file + gh -> config + problems", shared with the
  // loader's own tests. `gh`'s answer is validated there, and its problem is
  // KEPT here rather than replaced by an empty list.
  const result = await loadConfig({
    readConfig: async () => text,
    repo: async () => read(root),
  });

  // A whole-file fault (not YAML, not a mapping) has no config to return, so
  // the defaults stand in, and whatever THEIR resolution raised is kept
  // alongside the `<file>` problem rather than dropped.
  const fallback =
    result.config === undefined ? await emptyConfigFor(root, deps) : undefined;

  return {
    root,
    config: result.config ?? fallback!.config,
    present: text !== undefined,
    problems: [...result.problems, ...(fallback?.problems ?? [])],
  };
}

/** Convenience for a bin that wants the project root and nothing else. */
export { PACKAGE_ROOT };
