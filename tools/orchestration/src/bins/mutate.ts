#!/usr/bin/env node
/**
 * `hexagen-orchestration-mutate` — the bin.
 *
 * The only process entry for the mutation engine. The CLI's own
 * `import.meta.url` guard is deleted rather than kept beside this edge: tsup
 * bundles the module into `dist/bins/mutate.js`, where that comparison is TRUE,
 * so a kept guard runs the CLI a second time. `runCli` is called exactly here.
 *
 * Nothing here reads the overlay: the engine's paths and its child processes
 * stay on the caller's cwd, which is what a manifest replay needs.
 */
import { realDeps, runCli } from "../mutate/cli.js";
import { EXIT_REFUSAL } from "../mutate/lib/mutate.js";

try {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    deps: realDeps,
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_REFUSAL;
}
