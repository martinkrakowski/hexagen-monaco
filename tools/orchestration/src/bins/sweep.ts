#!/usr/bin/env node
/**
 * `hexagen-orchestration-sweep` — the bin.
 *
 * The commands are in `../sweep/`; this is the thin edge that supplies the
 * real `gh`, the real filesystem, the real stdin, and the project's overlay.
 *
 * Two things are decided here, before any command runs:
 *
 * 1. The overlay. A file that is present and has problems is a refusal —
 *    a sweep that posted a comment, or let a merge through, on settings nobody
 *    had cleared is the failure this package exists to prevent.
 * 2. The repository. Every `gh` call this bin makes is pointed at
 *    `config.repo`, and the GraphQL query takes the two halves as variables.
 *    A sweep with no repository to point at would ask the forge about whatever
 *    repository the working directory happened to be, so it refuses instead:
 *    exit 2, a line naming `repo`, no `gh` call at all.
 */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { errorText } from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { makeGh, runCli } from "../sweep/cli.js";
import { parseRepoRef } from "../sweep/lib/types.js";

/**
 * The process environment, taken whole. The two overrides below are
 * runtime-only: no task declares them, and a `process.env.X` member access
 * would trip `turbo/no-undeclared-env-vars` for a variable that exists only at
 * the caller's discretion — the same reason the event writer is handed
 * `process.env` rather than read piecemeal.
 */
const processEnv: Readonly<Record<string, string | undefined>> = process.env;

const loaded = await loadConfigFor();
const { root, config } = loaded;

const refusal = configRefusal("sweep", "act on this repository", loaded);
const repo = parseRepoRef(config.repo);

if (refusal !== undefined) {
  for (const line of refusal) console.error(line);
  process.exitCode = 2;
} else if (repo === undefined) {
  console.error(
    "sweep: no repository to act on: set `repo` as owner/name in " +
      ".agents/orchestration/config.yaml, or let `gh repo view` answer it.",
  );
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await runCli({
      argv: process.argv.slice(2),
      config,
      root,
      repo,
      log: (text) => console.log(text),
      logError: (text) => console.error(text),
      readFile: (path) => readFile(resolve(root, path), "utf8"),
      writeFile: (path, contents) =>
        writeFile(resolve(root, path), contents, "utf8"),
      readStdin: async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin)
          chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString("utf8");
      },
      // A runtime-only override, read here and nowhere else.
      env: {
        ...(processEnv.APPEND_ONLY !== undefined
          ? { APPEND_ONLY: processEnv.APPEND_ONLY }
          : {}),
        ...(processEnv.REQUIRED_CHECK !== undefined
          ? { REQUIRED_CHECK: processEnv.REQUIRED_CHECK }
          : {}),
      },
      gh: makeGh(execFile, processEnv),
    });
  } catch (error: unknown) {
    console.error(errorText(error));
    process.exitCode = 1;
  }
}
