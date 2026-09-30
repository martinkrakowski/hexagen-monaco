#!/usr/bin/env node
/**
 * `hexagen-orchestration-gate` — the bin.
 *
 * It supplies the real filesystem, the real process and the real overlay, and
 * hands them to the CLI in `../gate/cli.ts`. Every decision is in there.
 *
 * The run loop is a shell script shipped beside this bin rather than code in
 * this file, because the loop's correctness is a shell property — traps,
 * signals, an exit code propagated verbatim — and a Node process would have to
 * re-derive all three instead of inheriting them. The path is resolved from
 * `import.meta.url`, so it is the same file whether this runs from `src/` or
 * from the bundled `dist/`: both sit two levels below the package root.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRepositoryRoot, loadConfigFor } from "../internal/project.js";
import { EXIT_UNUSABLE, runGate } from "../gate/cli.js";

const root = await findRepositoryRoot();
const loaded = await loadConfigFor(root);

/** The loop, next to this bin, whatever this bin is running from. */
const loopScript = fileURLToPath(
  new URL("../../bin/gate-run.sh", import.meta.url),
);

/**
 * The root `package.json`'s scripts, or `undefined`.
 *
 * `undefined` and an empty map are the same answer to the only question the
 * skip rule asks — is this script there? — so a project with no readable
 * `package.json` behaves like one whose scripts are all absent, which is what a
 * gate should do rather than guess at scripts it cannot read.
 */
function readRootScripts(): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (typeof scripts !== "object" || scripts === null) return undefined;
    return scripts as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * The loop, with the project's own `node_modules/.bin` FIRST on `PATH`.
 *
 * A gate step is a command the project wrote, and a project's tools are its own
 * hoisted binaries; a step that shells out to `vitest` must find the version
 * this repo pinned rather than whatever the host happens to have. The existing
 * `PATH` is kept behind it, so everything that worked before still resolves.
 */
// turbo/no-undeclared-env-vars: PATH is read at RUN time to find the project's
// own binaries — it is not a build input, so turbo's cache has nothing to
// invalidate, and turbo.json is a never-edit file.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const inheritedPath = process.env.PATH ?? "";
const pathWithLocalBins = [
  join(root, "node_modules", ".bin"),
  inheritedPath,
].join(delimiter);

try {
  process.exitCode = runGate(
    process.argv.slice(2),
    {
      config: loaded.config,
      present: loaded.present,
      problems: loaded.problems,
    },
    {
      env: { ...process.env, PATH: pathWithLocalBins },
      log: (text) => process.stdout.write(text),
      logError: (text) => process.stderr.write(`${text}\n`),
      readScripts: readRootScripts,
      runLoop: ({ script, argv, cwd, env }) => {
        const child = spawnSync("sh", [script, ...argv], {
          cwd,
          env,
          // The loop's output IS the gate's output: a gate that buffered a
          // failing test run would report it late, and the exit code would be
          // the only thing that arrived.
          stdio: "inherit",
        });
        if (child.error !== undefined) {
          process.stderr.write(
            `gate: could not start ${script}: ${child.error.message}\n`,
          );
          return EXIT_UNUSABLE;
        }
        if (child.status !== null) return child.status;
        // Killed by a signal: `status` is null and the convention is 128+signo,
        // which is also what the loop itself would have reported had it been
        // the process that died.
        return child.signal === null
          ? EXIT_UNUSABLE
          : 128 + signalNumber(child.signal);
      },
    },
    loopScript,
    root,
  );
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_UNUSABLE;
}

/** `SIGTERM` → 15, by name. Node does not export the numbers. */
function signalNumber(signal: NodeJS.Signals): number {
  const table: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return table[signal] ?? 1;
}
