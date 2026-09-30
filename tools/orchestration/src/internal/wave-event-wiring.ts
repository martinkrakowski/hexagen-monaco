import { appendFile, mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { type Config, type ConfigProblem } from "./config.js";
import { configRefusal } from "./refusal.js";
import { runWaveEvent, type WaveEventDeps } from "./wave-event-cli.js";

/**
 * The bin's wiring, kept out of `src/bins/wave-event.ts` so it can be tested.
 *
 * `bins/wave-event.ts` runs at import time (top-level await, `process.exitCode`),
 * so nothing that imports it can be a unit test. Every decision the bin makes
 * about the ENVIRONMENT and the CONFIG lives here instead, and the bin is left
 * with nothing to get wrong: read the real process, call this, set the exit code.
 */

/** What `loadConfigFor` returns, as this wiring needs it. */
export interface LoadedProject {
  readonly config: Config;
  /** Whether `.agents/orchestration/config.yaml` exists at all. */
  readonly present: boolean;
  readonly problems: readonly ConfigProblem[];
}

/** The world the bin touches, injected so a test can watch it. */
export interface WaveEventIo {
  /** True only for a DIRECTORY. A missing path and a regular file are both false. */
  readonly isDirectory: (path: string) => boolean;
  readonly mkdir: (path: string) => Promise<void>;
  readonly appendFile: (path: string, data: string) => Promise<void>;
  readonly clock: () => string;
  readonly stderr?: (line: string) => void;
}

/** The real filesystem and clock. */
export const nodeWaveEventIo: WaveEventIo = {
  // The shell this bin replaced probes candidates with `[ -d ]`
  // (`wave-event.sh:66-76`), so a regular file named like a candidate is NOT
  // one. `existsSync` would say yes, the port would pick the file, and `mkdir`
  // on it would throw EEXIST while the shell went on to the real directory.
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  appendFile: async (path, data) => {
    await appendFile(path, data, "utf8");
  },
  clock: () => new Date().toISOString().replace(/\.\d+Z$/, "Z"),
};

/**
 * The environment `defaultLogDir` reads, taken from the process's own.
 *
 * `HOME` is passed through ONLY when it is set. An unset or empty `HOME`
 * resolves to `/tmp` in `logdir.ts`, exactly as `wave-event.sh:64` does, so
 * substituting `os.homedir()` here would send events to a directory the shell
 * (and every reader that follows the same rule) would never look in.
 */
export function waveEventEnv(
  processEnv: NodeJS.ProcessEnv,
): WaveEventDeps["env"] {
  return {
    ...(processEnv.LOGDIR !== undefined ? { LOGDIR: processEnv.LOGDIR } : {}),
    ...(processEnv.HOME !== undefined ? { HOME: processEnv.HOME } : {}),
    ...(processEnv.WAVE_LOG_ROOT !== undefined
      ? { WAVE_LOG_ROOT: processEnv.WAVE_LOG_ROOT }
      : {}),
  };
}

/** Every dependency the event writer needs, assembled from the environment and the config. */
export function buildWaveEventDeps(
  processEnv: NodeJS.ProcessEnv,
  config: Config,
  io: WaveEventIo,
): WaveEventDeps {
  return {
    env: waveEventEnv(processEnv),
    config: {
      ...(config.repo !== undefined ? { repo: config.repo } : {}),
      ...(config.waveLogDir !== undefined
        ? { waveLogDir: config.waveLogDir }
        : {}),
    },
    exists: io.isDirectory,
    mkdir: io.mkdir,
    appendFile: io.appendFile,
    clock: io.clock,
    ...(io.stderr !== undefined ? { stderr: io.stderr } : {}),
  };
}

/**
 * Run the event writer for a loaded project, returning the exit code.
 *
 * A config file that EXISTS but has schema problems is a refusal (exit 2, the
 * writer's own refusal code, nothing appended). The loader hands back defaults
 * for such a file, and defaults include a `repo` from `gh`, so without this
 * check an event would be filed under `$HOME/.waves-<gh name>/` while the
 * project's own `waveLogDir` sat in the file being ignored. A misrouted log is
 * worse than a loud refusal. An ABSENT file is not a refusal: it keeps the
 * defaults, as a project that never ran `init` expects.
 */
export async function runWaveEventForProject(
  argv: readonly string[],
  processEnv: NodeJS.ProcessEnv,
  loaded: LoadedProject,
  io: WaveEventIo,
): Promise<number> {
  const refusal = configRefusal("wave-event", "append", loaded);
  if (refusal !== undefined) {
    const say =
      io.stderr ?? ((line: string) => void process.stderr.write(`${line}\n`));
    for (const line of refusal) say(line);
    return 2;
  }
  return runWaveEvent(argv, buildWaveEventDeps(processEnv, loaded.config, io));
}
