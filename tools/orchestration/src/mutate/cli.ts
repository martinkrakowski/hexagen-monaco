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

export const realDeps: MutationDeps = {
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
      const child = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

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
        reject(err);
      });

      child.on("close", (code) => {
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
