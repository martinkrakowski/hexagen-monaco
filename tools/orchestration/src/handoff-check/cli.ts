import { HandoffError, parseHandoff } from "./lib/handoff.js";
import { checkHandoff, exitCodeFor, formatReport } from "./lib/check.js";
import type { HandoffDeps } from "./lib/types.js";

export const EXIT_MALFORMED = 2;

export interface HandoffCliIo {
  readonly argv: readonly string[];
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly readFile: (path: string) => Promise<string>;
  readonly deps: HandoffDeps;
}

export async function runCli(io: HandoffCliIo): Promise<number> {
  const [path] = io.argv;
  if (path === undefined || path === "") {
    io.logError("usage: handoff:check <handoff.json>");
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

  let handoff;
  try {
    handoff = parseHandoff(text);
  } catch (error) {
    // parseHandoff throws only HandoffError. The guard exists so an unexpected
    // failure surfaces as itself rather than as a bad handoff.
    if (!(error instanceof HandoffError)) throw error;
    io.logError(`${path}: ${error.message}`);
    return EXIT_MALFORMED;
  }
  let report;
  try {
    report = await checkHandoff(handoff, io.deps);
  } catch (error) {
    // A declared file that cannot be read, or a runner that produced no report:
    // the handoff is unusable, not unready. Saying which is the difference
    // between "add a test" and "fix your paths".
    io.logError(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_MALFORMED;
  }
  io.log(formatReport(report));
  return exitCodeFor(report);
}
