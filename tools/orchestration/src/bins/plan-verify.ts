#!/usr/bin/env node
/**
 * `hexagen-orchestration-plan-verify` — the bin.
 *
 * The check itself is in `../plan-verify/cli.ts`; this is the thin edge that
 * supplies the real filesystem, the real shell and the real git.
 *
 * `planDir` comes from the project's overlay, not from a constant: a packaged
 * tool that assumes `docs/planning` works on exactly one project.
 */
import { execFile } from "node:child_process";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  artifactPathFor,
  errorText,
  writeArtifact,
} from "../internal/artifact.js";
import { loadConfigFor } from "../internal/project.js";
import { configRefusal } from "../internal/refusal.js";
import { runCli } from "../plan-verify/cli.js";
import { PREMISE_TIMEOUT_MS } from "../plan-verify/lib/verify.js";
import type { VerifyDeps } from "../internal/premise-types.js";

const loaded = await loadConfigFor();
const { root, config } = loaded;

/**
 * Run a premise as a POSIX `sh` script, killing it at the ceiling. It runs FROM
 * THE REPOSITORY ROOT: premises are written against repo-relative paths, and the
 * caller may have started this bin in any subdirectory.
 */
const deps: VerifyDeps = {
  execute: (script) =>
    new Promise((resolve) => {
      execFile(
        "sh",
        ["-c", script],
        { timeout: PREMISE_TIMEOUT_MS, cwd: root },
        (error, stdout, stderr) => {
          const err = (error ?? null) as
            | (NodeJS.ErrnoException & {
                code?: number | string;
                killed?: boolean;
              })
            | null;
          resolve({
            exitCode:
              err === null ? 0 : typeof err.code === "number" ? err.code : 1,
            output: `${stdout}${stderr}`.trim(),
            // A premise killed at the ceiling has NO verdict. Reporting it as
            // `stale` would accuse a live lane; reporting it as `holds` would
            // hide a check that never finished (verify.ts:100).
            timedOut: err?.killed === true,
          });
        },
      );
    }),
};

// This bin ACTS on `planDir`, so an invalid overlay is a refusal, not a run.
const refusal = configRefusal("plan-verify", "verify", loaded);
if (refusal !== undefined) {
  for (const line of refusal) console.error(line);
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await runCli({
      argv: process.argv.slice(2),
      log: (text) => console.log(text),
      readFile: (path) => readFile(resolve(root, path), "utf8"),
      listPlanDir: () => readdir(`${root}/${config.planDir}`),
      deps,
      now: () => new Date().toISOString(),
      git: (args) =>
        new Promise((resolve, reject) => {
          execFile("git", args, { cwd: root }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
          });
        }),
      artifactPath: () =>
        artifactPathFor(process.env, {
          ...(config.repo !== undefined ? { repo: config.repo } : {}),
          ...(config.waveLogDir !== undefined
            ? { waveLogDir: config.waveLogDir }
            : {}),
        }),
      writeArtifact: async (path, contents) => {
        await mkdir(dirname(path), { recursive: true });
        await writeArtifact(path, contents);
      },
      planDir: config.planDir,
      ...(config.repo !== undefined ? { repo: config.repo } : {}),
    });
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : errorText(error));
    process.exitCode = 1;
  }
}
