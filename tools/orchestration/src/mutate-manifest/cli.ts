import { parseManifest, ManifestError } from "./lib/manifest.js";
import {
  exitCodeFor,
  formatChecks,
  replayManifest,
  type ScratchDeps,
} from "./lib/replay.js";
import type { MutationDeps } from "../mutate/lib/types.js";

export const EXIT_MALFORMED = 2;
/** A signal arrived and the mutation could not be put back: report it, never a verdict. */
export const EXIT_UNRESTORED = 2;

export interface ManifestCliIo {
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  readonly deps: MutationDeps;
  readonly scratch: ScratchDeps;
}

/**
 * Puts the file back before the process dies, so an interrupt during a
 * verification cannot leave the working tree mutated — the one thing a mutate
 * tool must never do. Same shape as `src/mutate/cli.ts`, which this mirrors.
 */
export const onSignal: NonNullable<MutationDeps["onSignal"]> = (cleanup) => {
  let cleanPromise: Promise<void> | null = null;
  const handler = () => {
    if (!cleanPromise) {
      cleanPromise = (async () => {
        try {
          await cleanup();
          process.exit(130);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(EXIT_UNRESTORED);
        }
      })();
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  process.on("SIGHUP", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
    process.off("SIGHUP", handler);
  };
};

/* Deferred imports: importing this module — a test does — must cost nothing. */
const nodeFs = () => import("node:fs/promises");

export const realDeps: MutationDeps = {
  readFile: async (path) => (await nodeFs()).readFile(path, "utf8"),
  readFileBuffer: async (path) => (await nodeFs()).readFile(path),
  writeFileBuffer: async (path, content) =>
    (await nodeFs()).writeFile(path, content),
  execute: async (command) => {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      const [bin, ...rest] = command;
      execFile(bin as string, rest, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException & { code?: number }).code;
        // A numeric code is the exit status of a process that ran and failed. Any other
        // code means it never launched, so the 1 below is a placeholder rather than a
        // result: name the failure instead of letting the 1 be read as a catch.
        resolve(
          typeof code === "number"
            ? { exitCode: code, stdout, stderr }
            : { exitCode: 1, stdout, stderr, launchError: error.message },
        );
      });
    });
  },
  onSignal,
};

export async function runCli(io: ManifestCliIo): Promise<number> {
  const [path] = io.argv;
  if (path === undefined || path === "") {
    io.logError("usage: hexagen-orchestration-mutate-verify <manifest.json>");
    return EXIT_MALFORMED;
  }
  let text: string;
  try {
    text = await io.readFile(path);
  } catch (error) {
    io.logError(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_MALFORMED;
  }
  let manifest;
  try {
    manifest = parseManifest(text);
  } catch (error) {
    /* istanbul ignore next -- parseManifest throws only ManifestError. This guard exists so that an
       unexpected failure surfaces as itself rather than being reported as a bad manifest. */
    if (!(error instanceof ManifestError)) throw error;
    io.logError(`${path}: ${error.message}`);
    return EXIT_MALFORMED;
  }
  const checks = await replayManifest(manifest, io.deps, io.scratch);
  io.log(formatChecks(manifest.lane, checks));
  return exitCodeFor(checks);
}
