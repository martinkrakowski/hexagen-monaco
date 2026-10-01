#!/usr/bin/env node
/**
 * `hexagen-orchestration-lane-watch` — the bin.
 *
 * Reads an opencode server's HTTP API (loopback only) to follow a lane's
 * progress or print its usage. The command is in `../lane-watch/`; this is the
 * edge that supplies the real `fetch`, the real terminal and the signals.
 * It reads no overlay: the server and the session arrive as flags.
 */
import { runLaneWatch } from "../lane-watch/cli.js";
import { EXIT_ERROR, errorText } from "../lane-watch/errors.js";

const interrupt = new AbortController();
const stop = (): void => interrupt.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  process.exitCode = await runLaneWatch({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    fetch: (url, init) => fetch(url, init),
    signal: interrupt.signal,
  });
} catch (error: unknown) {
  console.error(`lane-watch: ${errorText(error)}`);
  process.exitCode = EXIT_ERROR;
}
