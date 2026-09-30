import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LOCKED_INVARIANTS, type Config } from "../../src/internal/config.js";
import type { RepoRef } from "../../src/sweep/lib/types.js";
import type { SweepCliIo, SweepEnv } from "../../src/sweep/cli.js";

/**
 * The fixtures every ported sweep test shares: one invented repository, one
 * invented overlay, and one `runCli` io whose every world is a stub.
 *
 * `acme/demo` is not a repository this tool is ever given. It is what a test
 * asserts against so that the query text, the `--repo` flags and the owner/name
 * variables are all visibly pointed at ONE pair that came from the config.
 */

/** The one repository the ported tests act on. */
export const REPO: RepoRef = { owner: "acme", name: "demo" };

/** A repository root that is the current working directory's package. */
export const ROOT = resolve(import.meta.dirname, "../..");

/** The overlay a test runs against. `acme/demo` is the invented repository. */
export function configFor(over: Partial<Config> = {}): Config {
  return {
    planDir: "docs/planning",
    gateSteps: [],
    requiredCheck: "^Build",
    forbiddenPorts: [],
    operatorDataPaths: [],
    laneHosts: [],
    seats: [],
    mutate: false,
    overrides: [],
    invariants: { ...LOCKED_INVARIANTS },
    repo: `${REPO.owner}/${REPO.name}`,
    waveStatusPort: 4318,
    ...over,
  };
}

export interface Harness {
  readonly io: SweepCliIo;
  readonly log: string[];
  readonly err: string[];
  /** Every path `writeFile` was asked to write, in order. */
  readonly writes: readonly { path: string; contents: string }[];
}

const NO_GH: SweepCliIo["gh"] = async () => "{}";

/**
 * The real CLI's answer to a flag `gh api` does not have. `gh api` takes no
 * `--repo` and no `-R` (it addresses the forge by endpoint or query), so a
 * stub that accepted either would pass a call the real `gh` refuses with exit 1
 * and `unknown flag: --repo` — which is how a broken `--post` shipped once.
 */
export function strictApi(gh: SweepCliIo["gh"]): SweepCliIo["gh"] {
  return async (args) => {
    if (args[0] === "api") {
      const bad = args.find((a) => a === "--repo" || a === "-R");
      if (bad !== undefined) throw new Error(`unknown flag: ${bad}`);
    }
    return gh(args);
  };
}

/**
 * A `runCli` io with every world stubbed. `over` replaces any part of it, so a
 * test that only cares about `gh` does not have to restate the rest.
 */
export function harness(
  over: Partial<SweepCliIo> = {},
  env: SweepEnv = {},
): Harness {
  const log: string[] = [];
  const err: string[] = [];
  const writes: { path: string; contents: string }[] = [];
  return {
    log,
    err,
    writes,
    io: {
      argv: [],
      config: configFor(),
      root: ROOT,
      repo: REPO,
      log: (text) => log.push(text),
      logError: (text) => err.push(text),
      readFile: (path) => readFile(resolve(ROOT, path), "utf8"),
      writeFile: (path, contents) => {
        writes.push({ path, contents });
        return writeFile(resolve(ROOT, path), contents, "utf8");
      },
      readStdin: async () => "",
      env,
      ...over,
      // Every stub is strict for `api`, whatever a test replaced it with.
      gh: strictApi(over.gh ?? NO_GH),
    },
  };
}

/** Whether `path` exists, for a caller that wants the real filesystem test. */
export const exists = existsSync;
