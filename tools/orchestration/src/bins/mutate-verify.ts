#!/usr/bin/env node
/**
 * `hexagen-orchestration-mutate-verify` — the bin.
 *
 * Replays one mutation manifest against the real mutation engine: every claim is
 * run, each against a green baseline first, and a claim that does not reproduce
 * is a MISMATCH (exit 1) rather than a pass.
 *
 * The scratch directory the replay writes its literal texts into lives here, not
 * in the ported module, because `src/bins/mutate-verify.ts` is the only process
 * entry. The ported `cli.ts` keeps its `import.meta.url` guard deleted: tsup
 * makes that comparison true inside this bundle, so a kept guard would run the
 * CLI a second time.
 *
 * Nothing here reads the overlay: the manifest, the files it anchors into and
 * the suites it runs all stay on the caller's cwd, which is what a replay needs.
 */
import { realDeps, runCli, EXIT_MALFORMED } from "../mutate-manifest/cli.js";
import type { ScratchDeps } from "../mutate-manifest/lib/replay.js";

const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");

const scratch: ScratchDeps = {
  makeDir: () => mkdtemp(join(tmpdir(), "mutate-manifest-")),
  writeText: (path, text) => writeFile(path, text, "utf8"),
  removeDir: (path) => rm(path, { recursive: true, force: true }),
  join,
};

try {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    readFile: realDeps.readFile,
    deps: realDeps,
    scratch,
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_MALFORMED;
}
