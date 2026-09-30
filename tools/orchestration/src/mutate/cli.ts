import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  parseArgs,
  runMutation,
  formatReport,
  RefusalError,
  EXIT_CAUGHT,
  EXIT_SURVIVED,
  EXIT_REFUSAL,
} from "./lib/mutate.js";
import type { MutationDeps } from "./lib/types.js";

/** The one thing an interrupt needs from a running command: to be told to stop. */
type Killable = { kill: (signal: NodeJS.Signals) => unknown };

/**
 * `spawnChild` is a parameter so a test can hand in a child it controls; the
 * real one is `spawn`. The child that is running is remembered so an interrupt
 * can stop it: restoring the file under a suite that is still running would let
 * the suite read, and report on, a file that is changing beneath it.
 */
export function createRealDeps(spawnChild: typeof spawn = spawn): MutationDeps {
  let running: Killable | undefined;
  return {
    readFile: async (path: string) => readFile(path, "utf8"),
    readFileBuffer: async (path: string) => readFile(path),
    writeFileBuffer: async (path: string, content: Buffer) =>
      writeFile(path, content),
    execute: async (command: readonly string[]) => {
      return new Promise((resolve, reject) => {
        const [cmd, ...args] = command;
        if (!cmd) {
          reject(new Error("empty command"));
          return;
        }
        const child = spawnChild(cmd, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
        running = child;

        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");

        child.stdout.on("data", (data: string) => {
          stdout += data;
        });
        child.stderr.on("data", (data: string) => {
          stderr += data;
        });

        child.on("error", (err) => {
          running = undefined;
          reject(err);
        });

        child.on("close", (code) => {
          running = undefined;
          resolve({
            exitCode: code ?? 1,
            stdout,
            stderr,
          });
        });
      });
    },
    onSignal: (cleanup) => {
      let cleanPromise: Promise<void> | null = null;
      const handler = () => {
        if (!cleanPromise) {
          cleanPromise = (async () => {
            try {
              // Stop the command first, then put the file back, then exit.
              running?.kill("SIGTERM");
              await cleanup();
              process.exit(130);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(message);
              process.exit(EXIT_REFUSAL);
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
    },
  };
}

export const realDeps: MutationDeps = createRealDeps();

export interface MutateCliIo {
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly deps?: MutationDeps;
}

export async function runCli(io: MutateCliIo): Promise<number> {
  const deps = io.deps ?? realDeps;
  try {
    const args = parseArgs(io.argv);
    const result = await runMutation(args, deps);
    io.log(formatReport(result));
    return result.verdict === "caught" ? EXIT_CAUGHT : EXIT_SURVIVED;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.logError(message);
    if (error instanceof RefusalError) {
      return error.exitCode;
    }
    return EXIT_REFUSAL;
  }
}
