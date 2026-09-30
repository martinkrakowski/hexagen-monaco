#!/usr/bin/env node
/**
 * `hexagen-orchestration-wave-status` — the bin.
 *
 * The faces live in `../wave-status/{cli,server}.ts`; this is the thin edge that
 * supplies the real process: the overlay, the environment, the filesystem, the
 * socket. It loads the config ONCE, refuses an invalid one, resolves the scan
 * root from it (and hands over a port resolver for the serve face), calls the CLI once, and sets the exit code.
 *
 * It ACTS on the overlay — it binds a port, scans a log root, and joins pull
 * requests — so a config file that exists and has problems is a refusal, not a
 * run: every problem is printed and nothing is started.
 */
import { errorText } from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { waveEventEnv } from "../internal/wave-event-wiring.js";
import { waveLogRoot } from "../internal/logdir.js";
import { collect } from "../wave-status/lib/collect.js";
import { runCli } from "../wave-status/cli.js";
import {
  defaultDeps,
  resolvePort,
  startServer,
} from "../wave-status/server.js";
import type { WaveStatus } from "../internal/wave-types.js";

const TOOL = "wave-status";

/**
 * The whole bin, as a function returning an exit code, so every refusal below is
 * a plain `return 2` rather than a `process.exit` buried in a branch. The one
 * process-level statement left is the assignment at the bottom.
 */
async function main(): Promise<number> {
  const loaded = await loadConfigFor();
  const { root, config } = loaded;

  // The refusal comes FIRST: a file that exists and has problems owes the
  // operator every one of them, and a `repo` the file wrote but got wrong is one
  // of those problems rather than an absence. Checking `repo` first would answer
  // one malformed field with "no repository is configured" and hide the rest.
  const refusal = configRefusal(
    TOOL,
    "serve or render the wave status",
    loaded,
  );
  if (refusal !== undefined) {
    for (const line of refusal) console.error(line);
    return 2;
  }

  // The repository is not optional here. Every `gh` path, the thread search and
  // the per-repository log root are all derived from it, and a status page that
  // joined the wrong repository's pull requests would report a wave as having no
  // PR — a confident, wrong answer about someone else's work. So the bin says
  // so and does neither of the two things it could otherwise do. (The overlay
  // itself is valid here: an absent file, or one that named a well-formed
  // `repo`, leaves nothing above to refuse.)
  if (config.repo === undefined) {
    console.error(
      `${TOOL}: refusing to run: no repository is configured.\n` +
        `  Set \`repo: owner/name\` in .agents/orchestration/config.yaml, ` +
        `or run \`hexagen-orchestration-doctor\` to see why it could not be resolved.`,
    );
    return 2;
  }

  // The scan root is resolved HERE, once, and handed to both faces: the server
  // and the print face must never disagree about which directory they are
  // reading, and this is the same resolution the event writer used to write it.
  const scanRoot = waveLogRoot(waveEventEnv(process.env), config);
  const env: NodeJS.ProcessEnv = process.env;

  return runCli({
    argv: process.argv.slice(2),
    defaultScanRoot: scanRoot,
    // Resolved lazily, on the serve path only: `--print` binds nothing, so a
    // `PORT` that is bad or forbidden must not stop it.
    port: () => {
      try {
        return resolvePort(process.env, config);
      } catch (error) {
        throw new Error(`${TOOL}: ${errorText(error)}`);
      }
    },
    isTTY: process.stdout.isTTY === true,
    noColor: env.NO_COLOR !== undefined,
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    collect: (root_): Promise<WaveStatus> =>
      collect(defaultDeps(root, config), root_, new Date().toISOString()),
    schedule: (fn, ms) => setTimeout(fn, ms),
    serve: (options) =>
      startServer({
        port: options.port,
        repoRoot: root,
        config,
        scanRoot: options.scanRoot,
      }),
  });
}

// A rejection out of `main` (an overlay that cannot be read, a face that throws
// before it has an answer) is reported as one line and exit 1, never as an
// unhandled rejection with a stack trace.
process.exitCode = await main().catch((error: unknown): number => {
  console.error(`${TOOL}: ${errorText(error)}`);
  return 1;
});
