#!/usr/bin/env node
/**
 * `hexagen-orchestration-fix-brief` — the bin.
 *
 * The command is in `../fix-brief/`; this is the thin edge that supplies the
 * real `gh`, the real filesystem and the project's overlay. As with `sweep`,
 * the repository the threads are read from comes from the overlay's `repo`, and
 * a bin with no repository to ask refuses (exit 2) before any `gh` call.
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { errorText } from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { parseFixBriefArgs } from "../fix-brief/args.js";
import { runFixBrief } from "../fix-brief/cli.js";
import { exclusiveWriter, pathExists } from "../fix-brief/files.js";
import { makeGh } from "../sweep/cli.js";
import { parseRepoRef } from "../sweep/lib/types.js";

const argv = process.argv.slice(2);

/**
 * The command line is judged BEFORE the overlay is loaded. Loading it can run
 * `gh repo view`, so a mistyped flag would otherwise cost a forge call and be
 * answered with whatever the overlay had to say instead of the usage.
 */
let argvProblem: string | undefined;
try {
  parseFixBriefArgs(argv);
} catch (error: unknown) {
  argvProblem = errorText(error);
}

const loaded = argvProblem === undefined ? await loadConfigFor() : undefined;
const refusal =
  loaded === undefined
    ? undefined
    : configRefusal("fix-brief", "act on this repository", loaded);
const repo = parseRepoRef(loaded?.config.repo);

if (argvProblem !== undefined) {
  console.error(argvProblem);
  process.exitCode = 2;
} else if (refusal !== undefined) {
  for (const line of refusal) console.error(line);
  process.exitCode = 2;
} else if (repo === undefined) {
  console.error(
    "fix-brief: no repository to act on: set `repo` as owner/name in " +
      ".agents/orchestration/config.yaml, or let `gh repo view` answer it.",
  );
  process.exitCode = 2;
} else {
  const write = exclusiveWriter();
  try {
    process.exitCode = await runFixBrief({
      argv,
      repo,
      gh: makeGh(execFile, process.env),
      log: (text) => console.log(text),
      logError: (text) => console.error(text),
      // `--out` is relative to where the operator ran the command, not to the
      // repository root: it is a path they typed.
      exists: (path) => pathExists(resolve(path)),
      writeExclusive: (path, text) => write(resolve(path), text),
    });
  } catch (error: unknown) {
    console.error(errorText(error));
    process.exitCode = 1;
  }
}
