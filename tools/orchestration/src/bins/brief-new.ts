#!/usr/bin/env node
/**
 * `hexagen-orchestration-brief-new` — the bin.
 *
 * The command is in `../brief-new/`; this is the thin edge that supplies the
 * project's overlay and the real filesystem. It needs no forge, so the overlay
 * is loaded without asking `gh` for the repository.
 */
import { resolve } from "node:path";
import { errorText } from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { parseBriefNewArgs } from "../brief-new/args.js";
import { runBriefNew } from "../brief-new/cli.js";
import { exclusiveWriterMakingDirectory } from "../brief-new/files.js";
import { pathExists } from "../fix-brief/files.js";

const argv = process.argv.slice(2);

/** The command line is judged BEFORE the overlay is loaded. */
let argvProblem: string | undefined;
try {
  parseBriefNewArgs(argv);
} catch (error: unknown) {
  argvProblem = errorText(error);
}

const loaded =
  argvProblem === undefined
    ? await loadConfigFor(undefined, { readRepository: () => undefined })
    : undefined;
const refusal =
  loaded === undefined
    ? undefined
    : configRefusal("brief-new", "name a lane host", loaded);

if (argvProblem !== undefined) {
  console.error(argvProblem);
  process.exitCode = 2;
} else if (refusal !== undefined) {
  for (const line of refusal) console.error(line);
  process.exitCode = 2;
} else {
  const write = exclusiveWriterMakingDirectory();
  try {
    process.exitCode = await runBriefNew({
      argv,
      hosts: () => loaded?.config.laneHosts ?? [],
      log: (text) => console.log(text),
      logError: (text) => console.error(text),
      // `--out` is relative to where the operator ran the command.
      exists: (path) => pathExists(resolve(path)),
      writeExclusive: (path, text) => write(resolve(path), text),
    });
  } catch (error: unknown) {
    console.error(errorText(error));
    process.exitCode = 1;
  }
}
