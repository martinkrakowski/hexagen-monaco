#!/usr/bin/env node
/**
 * `hexagen-orchestration-mutate-anchors` — the bin.
 *
 * Asks of EVERY manifest in the directory, never a diff: does each live
 * mutation's before-text still appear exactly once in its file, and does each
 * `-t` pattern still select a test?
 *
 * This is the bin that reaches `typescript` at run time. `lib/test-names.ts`
 * imports the compiler API to read test names off syntax, and `lib/anchors.ts`
 * imports that — so a static `import "typescript"` is in this bundle's graph.
 * It stays external (declared in `dependencies`) and a consumer resolves it
 * through normal npm resolution; `__tests__/mutate-manifest/typescript-runtime
 * .test.ts` runs this built bin for real, because only the built bin can fail
 * this way.
 *
 * The directory listing and the `vitest list` spawn live here, not in the
 * ported module, because this file is the only process entry.
 */
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXIT_UNUSABLE, runAnchorCli } from "../mutate-manifest/anchors-cli.js";

try {
  process.exitCode = await runAnchorCli({
    argv: process.argv.slice(2),
    log: (text) => console.log(text),
    logError: (text) => console.error(text),
    listManifests: async (dir) =>
      (await readdir(dir))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => join(dir, name)),
    deps: {
      readText: (path) => readFile(path, "utf8"),
      now: () => performance.now(),
      // `vitest list` collects without running: it prints one line per selected
      // test and nothing at all when `-t` selects none. A non-zero exit means
      // the collection itself failed, and that is reported as a fault rather
      // than read as "no tests" — a check that cannot look must not pass.
      listTests: (command) =>
        new Promise((resolve, reject) => {
          const [bin, ...rest] = command;
          execFile(
            bin as string,
            rest,
            {
              env: { ...process.env, NO_COLOR: "1" },
              maxBuffer: 32 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
              if (error !== null) {
                reject(
                  new Error(
                    `\`${command.join(" ")}\` failed: ${stderr.trim() || error.message}`,
                  ),
                );
                return;
              }
              resolve(stdout.split("\n").filter((line) => line.trim() !== ""));
            },
          );
        }),
    },
  });
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = EXIT_UNUSABLE;
}
