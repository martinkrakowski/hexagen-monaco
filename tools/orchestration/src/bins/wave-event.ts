#!/usr/bin/env node
/**
 * `hexagen-orchestration-wave-event` — the bin.
 *
 * All the behaviour is in `../internal/wave-event-cli.ts`, and every decision
 * about the environment and the config is in `../internal/wave-event-wiring.ts`,
 * which is tested. This file is the thin edge: load the project, hand over the
 * real process, and turn the returned code into the exit code.
 */
import { loadConfigFor } from "../internal/project.js";
import {
  nodeWaveEventIo,
  runWaveEventForProject,
} from "../internal/wave-event-wiring.js";

process.exitCode = await runWaveEventForProject(
  process.argv.slice(2),
  process.env,
  await loadConfigFor(),
  nodeWaveEventIo,
);
