#!/usr/bin/env node
/**
 * `hexagen-orchestration-wave-event` — the bin.
 *
 * All the behaviour is in `../internal/wave-event-cli.ts`, which takes its
 * filesystem and clock by injection so it can be tested without spawning
 * anything. This file is the thin edge: read the real environment, hand over the
 * real argv, and turn the returned code into the process's exit code.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { runWaveEvent } from "../internal/wave-event-cli.js";
import { loadConfigFor } from "../internal/project.js";

const { config } = await loadConfigFor();

process.exitCode = await runWaveEvent(process.argv.slice(2), {
  /* eslint-disable turbo/no-undeclared-env-vars --
   * LOGDIR and WAVE_LOG_ROOT are OPERATOR-SET variables an installed bin reads
   * at run time to decide which log directory a wave belongs in. They are not
   * inputs to this workspace's build, so turbo's cache has nothing to
   * invalidate and `globalEnv` has nothing to declare them for. turbo.json is a
   * never-edit file, and adding two runtime variables to it would be the wrong
   * fix even if it were not. */
  env: {
    ...(process.env.LOGDIR !== undefined ? { LOGDIR: process.env.LOGDIR } : {}),
    HOME: homedir(),
    ...(process.env.WAVE_LOG_ROOT !== undefined
      ? { WAVE_LOG_ROOT: process.env.WAVE_LOG_ROOT }
      : {}),
  },
  config: {
    ...(config.repo !== undefined ? { repo: config.repo } : {}),
    ...(config.waveLogDir !== undefined
      ? { waveLogDir: config.waveLogDir }
      : {}),
  },
  exists: existsSync,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  appendFile: async (path, data) => {
    await appendFile(path, data, "utf8");
  },
  clock: () => new Date().toISOString().replace(/\.\d+Z$/, "Z"),
});
