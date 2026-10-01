#!/usr/bin/env node
/**
 * `hexagen-orchestration-lane-watch` — the bin.
 *
 * Reads an opencode server's HTTP API (loopback only) to follow a lane's
 * progress or print its usage. The command is in `../lane-watch/`; this is the
 * edge that supplies the real `fetch`, the real terminal and the signals.
 * It reads no overlay: the server and the session arrive as flags.
 */
import { constants } from "node:os";
import { runLaneWatch } from "../lane-watch/cli.js";
import {
  EXIT_ERROR,
  EXIT_INTERRUPTED,
  errorText,
} from "../lane-watch/errors.js";

const interrupt = new AbortController();
let signalNumber: number | undefined;
const stopOn = (name: "SIGINT" | "SIGTERM") => (): void => {
  signalNumber = constants.signals[name];
  interrupt.abort();
};
process.once("SIGINT", stopOn("SIGINT"));
process.once("SIGTERM", stopOn("SIGTERM"));

try {
  const code = await runLaneWatch({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    fetch: (url, init) => fetch(url, init),
    signal: interrupt.signal,
  });
  // 128 + the signal number, as the gate does: 130 for INT, 143 for TERM.
  process.exitCode =
    code === EXIT_INTERRUPTED && signalNumber !== undefined
      ? 128 + signalNumber
      : code;
} catch (error: unknown) {
  console.error(`lane-watch: ${errorText(error)}`);
  process.exitCode = EXIT_ERROR;
}
