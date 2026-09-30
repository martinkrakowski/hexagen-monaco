#!/usr/bin/env node
/**
 * `hexagen-orchestration-handoff-check` — the bin.
 *
 * Supplies the real filesystem and the real test runner. The runner is the
 * project's own local `vitest`, never a `yarn` alias: the source shelled out to
 * `yarn vitest`, which only resolves inside a Yarn workspace that happens to
 * hoist it (A-9).
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfigFor } from "../internal/project.js";

const { root } = await loadConfigFor();
import { EXIT_MALFORMED, runCli } from "../handoff-check/cli.js";
import type { HandoffDeps } from "../handoff-check/lib/types.js";

/**
 * Vitest's JSON reporter, read for the names of failing tests.
 *
 * `--reporter=json` writes the run to stdout; a NON-ZERO exit is expected here
 * and is not an error, because a stage-1 handoff is supposed to be red.
 */
const failingTests = (files: readonly string[]): Promise<readonly string[]> =>
  new Promise((resolvePromise, reject) => {
    const local = join(root, "node_modules", ".bin", "vitest");
    const [command, args] = existsSync(local)
      ? ([local, ["run", "--reporter=json", ...files]] as const)
      : ([
          "npx",
          ["--no-install", "vitest", "run", "--reporter=json", ...files],
        ] as const);
    execFile(
      command,
      [...args],
      // The declared files are repo-relative, so vitest runs from the root.
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
      (_error, stdout) => {
        const start = stdout.indexOf("{");
        if (start === -1) {
          reject(new Error("vitest produced no JSON report"));
          return;
        }
        try {
          const report = JSON.parse(stdout.slice(start)) as {
            testResults?: {
              assertionResults?: { title?: string; status?: string }[];
            }[];
          };
          const failed: string[] = [];
          for (const file of report.testResults ?? []) {
            for (const a of file.assertionResults ?? []) {
              if (a.status === "failed" && typeof a.title === "string")
                failed.push(a.title);
            }
          }
          resolvePromise(failed);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });

const deps: HandoffDeps = {
  readFile: (path) => readFile(resolve(root, path), "utf8"),
  failingTests,
};

try {
  process.exitCode = await runCli({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    readFile: (path) => readFile(resolve(root, path), "utf8"),
    deps,
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_MALFORMED;
}
