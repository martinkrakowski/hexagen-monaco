export type Verdict = "caught" | "survived";

export interface ParsedMutateArgs {
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly because: string;
  readonly command: readonly string[];
}

export interface MutationResult {
  readonly exitCode: number;
  readonly verdict: Verdict;
  readonly because: string;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Set when the command never ran — a missing binary, a spawn failure. There
   * is then no exit code to read: `exitCode` is a placeholder and `verdict` is
   * not evidence of anything. Read this before believing either of them.
   */
  readonly launchError?: string;
}

/**
 * What a command run produced. `launchError` distinguishes "the process never
 * started" from "the process ran and failed": both are non-zero, but only the
 * second one is evidence that a test caught something.
 */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly launchError?: string;
}

export interface MutationDeps {
  readonly readFile: (path: string) => Promise<string>;
  readonly readFileBuffer: (path: string) => Promise<Buffer>;
  readonly writeFileBuffer: (path: string, content: Buffer) => Promise<void>;
  readonly execute: (command: readonly string[]) => Promise<ExecResult>;
  readonly onSignal?: (cleanup: () => Promise<void> | void) => () => void;
}
