#!/usr/bin/env node
/**
 * `hexagen-orchestration-plan-review` — the bin.
 *
 * The three subcommands are in `../plan-review/cli.ts`; this is the thin edge
 * that supplies the real filesystem, the real environment, and the project's
 * overlay. The overlay is read ONCE, here, and a file that is present and has
 * problems is a refusal before any subcommand runs — a gate that hashed rows or
 * cleared a merge on settings nobody had cleared would be the failure this
 * package exists to prevent.
 *
 * `planDir`, `repo` and `waveLogDir` reach the CLI as `config`, never as a
 * constant and never as a value looked up from the working directory.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { errorText } from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { waveEventEnv } from "../internal/wave-event-wiring.js";
import { runCli } from "../plan-review/cli.js";

const loaded = await loadConfigFor();
const { root, config } = loaded;

const refusal = configRefusal("plan-review", "judge plan rows", loaded);
if (refusal !== undefined) {
  for (const line of refusal) console.error(line);
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await runCli({
      argv: process.argv.slice(2),
      config,
      root,
      log: (text) => console.log(text),
      logError: (text) => console.error(text),
      // Plan paths are the repository's: relative to the root, never the cwd.
      readFile: (path) => readFile(resolve(root, path), "utf8"),
      // Log paths are the event writer's: relative to the cwd, as `wave-event`
      // resolves them, so a gate reads the file the writer wrote.
      readLogFile: (path) => readFile(path, "utf8"),
      readdir: (dir) => readdir(dir),
      exists: (path) => existsSync(path),
      // The ONE projection of the environment `defaultLogDir` reads, shared
      // with the event writer so a gate and the writer it is checking can never
      // name a different directory for the same wave.
      env: waveEventEnv(process.env),
    });
  } catch (error: unknown) {
    // An unexpected throw means the command could not RUN. Exit 1 is reserved for
    // a refusal (an `InvalidRiskCellError` is caught inside `runCli` and still
    // returns 1), so a crash must not read as a verdict about a lane.
    console.error(errorText(error));
    process.exitCode = 2;
  }
}
