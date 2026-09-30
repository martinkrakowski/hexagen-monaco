#!/usr/bin/env node
/**
 * `hexagen-orchestration-control-bytes` — the bin.
 *
 * The scan is in `../control-bytes/lib/scan.ts`; this is the thin edge that
 * supplies the real file listing and the real reads.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfigFor } from "../internal/project.js";
import { EXIT_UNUSABLE, runCli } from "../control-bytes/cli.js";

const { root } = await loadConfigFor();

/**
 * Tracked files PLUS untracked-but-not-ignored ones, so a file a lane just
 * wrote and has not staged is already in scope — that is precisely the moment
 * the byte gets in. `--exclude-standard` keeps gitignored operator data and
 * `node_modules` out without a second list to maintain.
 */
const listFiles = (): Promise<readonly string[]> =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(
          stdout
            .toString("utf8")
            .split("\0")
            .filter((name) => name !== ""),
        );
      },
    );
  });

try {
  process.exitCode = await runCli({
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    listFiles,
    // `git ls-files` paths are root-relative, so they are read from the root.
    readBytes: (path) => readFile(resolve(root, path)),
    now: () => performance.now(),
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_UNUSABLE;
}
