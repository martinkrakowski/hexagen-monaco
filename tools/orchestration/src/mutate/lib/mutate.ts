import type {
  MutationDeps,
  MutationResult,
  ParsedMutateArgs,
  Verdict,
} from "./types.js";

export const EXIT_CAUGHT = 0;
export const EXIT_SURVIVED = 1;
export const EXIT_REFUSAL = 2;

export class RefusalError extends Error {
  readonly rule: string;
  readonly exitCode: number;

  constructor(rule: string, message: string, exitCode = EXIT_REFUSAL) {
    super(message);
    this.name = "RefusalError";
    this.rule = rule;
    this.exitCode = exitCode;
  }
}

export function parseArgs(argv: readonly string[]): ParsedMutateArgs {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex === -1) {
    throw new RefusalError(
      "usage",
      "Refusal: missing '--' separator before command",
    );
  }

  const flagArgs = argv.slice(0, separatorIndex);
  const command = argv.slice(separatorIndex + 1);
  if (command.length === 0) {
    throw new RefusalError("usage", "Refusal: missing command after '--'");
  }

  let file: string | undefined;
  let before: string | undefined;
  let after: string | undefined;
  let because: string | undefined;

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i]!;
    if (arg === "--file") {
      const next = flagArgs[++i];
      if (!next || next.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --file requires a path");
      file = next;
    } else if (arg.startsWith("--file=")) {
      const val = arg.slice("--file=".length);
      if (!val || val.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --file requires a path");
      file = val;
    } else if (arg === "--before") {
      const next = flagArgs[++i];
      if (!next || next.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --before requires a path");
      before = next;
    } else if (arg.startsWith("--before=")) {
      const val = arg.slice("--before=".length);
      if (!val || val.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --before requires a path");
      before = val;
    } else if (arg === "--after") {
      const next = flagArgs[++i];
      if (!next || next.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --after requires a path");
      after = next;
    } else if (arg.startsWith("--after=")) {
      const val = arg.slice("--after=".length);
      if (!val || val.startsWith("-"))
        throw new RefusalError("usage", "Refusal: --after requires a path");
      after = val;
    } else if (arg === "--because") {
      const next = flagArgs[++i];
      if (next === undefined)
        throw new RefusalError(
          "Rule 5",
          "Refusal (Rule 5): missing required flag --because",
        );
      if (next.startsWith("-"))
        throw new RefusalError(
          "Rule 5",
          "Refusal (Rule 5): --because value cannot start with '-'",
        );
      because = next;
    } else if (arg.startsWith("--because=")) {
      const val = arg.slice("--because=".length);
      if (val.startsWith("-"))
        throw new RefusalError(
          "Rule 5",
          "Refusal (Rule 5): --because value cannot start with '-'",
        );
      because = val;
    } else {
      throw new RefusalError(
        "usage",
        `Refusal: unknown argument: ${JSON.stringify(arg)}`,
      );
    }
  }

  if (!file)
    throw new RefusalError("usage", "Refusal: missing required flag --file");
  if (!before)
    throw new RefusalError("usage", "Refusal: missing required flag --before");
  if (!after)
    throw new RefusalError("usage", "Refusal: missing required flag --after");
  if (because === undefined)
    throw new RefusalError(
      "Rule 5",
      "Refusal (Rule 5): missing required flag --because",
    );
  if (because.trim().length === 0)
    throw new RefusalError(
      "Rule 5",
      "Refusal (Rule 5): --because cannot be empty",
    );
  if (because.includes("\n") || because.includes("\r")) {
    throw new RefusalError(
      "Rule 5",
      "Refusal (Rule 5): --because must be a single line",
    );
  }

  return { file, before, after, because, command };
}

export function countOccurrences(content: string, substring: string): number {
  if (substring.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(substring, pos)) !== -1) {
    count++;
    pos += substring.length;
  }
  return count;
}

export function applyMutation(
  originalContent: string,
  beforeText: string,
  afterText: string,
  filePath: string,
): string {
  // Rule 3: Refuse a no-op
  if (beforeText.length === 0) {
    throw new RefusalError(
      "Rule 3",
      "Refusal (Rule 3): before-text is empty; an empty before-text is not a mutation",
    );
  }
  if (beforeText === afterText) {
    throw new RefusalError(
      "Rule 3",
      "Refusal (Rule 3): before-text and after-text are identical; a no-op is not a mutation",
    );
  }

  // Rule 2: Exactly one occurrence, or refuse
  const occurrences = countOccurrences(originalContent, beforeText);
  if (occurrences === 0) {
    throw new RefusalError(
      "Rule 2",
      `Refusal (Rule 2): before-text not found in ${filePath} (0 occurrences)`,
    );
  }
  if (occurrences > 1) {
    throw new RefusalError(
      "Rule 2",
      `Refusal (Rule 2): before-text is ambiguous: found ${occurrences} occurrences in ${filePath} (must be exactly one)`,
    );
  }

  // Rule 1: Literal replacement only, no regular expressions
  const index = originalContent.indexOf(beforeText);
  return (
    originalContent.slice(0, index) +
    afterText +
    originalContent.slice(index + beforeText.length)
  );
}

export async function runMutation(
  args: ParsedMutateArgs,
  deps: MutationDeps,
): Promise<MutationResult> {
  let originalBuffer: Buffer;
  try {
    originalBuffer = await deps.readFileBuffer(args.file);
  } catch (error) {
    throw new RefusalError(
      "Rule 1",
      `Refusal (Rule 1): failed to read target file ${args.file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const originalContent = originalBuffer.toString("utf8");

  let beforeText: string;
  try {
    beforeText = await deps.readFile(args.before);
  } catch (error) {
    throw new RefusalError(
      "Rule 1",
      `Refusal (Rule 1): failed to read before-file ${args.before}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let afterText: string;
  try {
    afterText = await deps.readFile(args.after);
  } catch (error) {
    throw new RefusalError(
      "Rule 1",
      `Refusal (Rule 1): failed to read after-file ${args.after}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const mutatedContent = applyMutation(
    originalContent,
    beforeText,
    afterText,
    args.file,
  );

  let isMutated = false;
  // The mutation write, while it is in flight. A signal can arrive before it
  // settles, and a restore that wrote first would be overwritten by it.
  let mutationWrite: Promise<void> | undefined;
  let restorePromise: Promise<void> | undefined;
  const restore = async (): Promise<void> => {
    if (!isMutated) return;
    if (!restorePromise) {
      restorePromise = (async () => {
        try {
          // Let a pending mutation write land first, so the original bytes are
          // always the LAST write. Its own failure is the main flow's to report.
          await mutationWrite?.catch(() => undefined);
          await deps.writeFileBuffer(args.file, originalBuffer);
          isMutated = false;
        } catch (error) {
          const cause = error instanceof Error ? error.message : String(error);
          throw new RefusalError(
            "Rule 6",
            `Refusal (Rule 6): failed to restore ${args.file}: ${cause}. Target file is left mutated; original content was recoverable from the pre-mutation buffer.`,
          );
        }
      })();
    }
    await restorePromise;
  };

  const unregisterSignal = deps.onSignal ? deps.onSignal(restore) : undefined;

  try {
    const mutatedBuffer = Buffer.from(mutatedContent, "utf8");
    isMutated = true;
    mutationWrite = deps.writeFileBuffer(args.file, mutatedBuffer);
    await mutationWrite;

    // Rule 4: Confirm the file holds the intended mutation after writing, and refuse if it does not.
    const readBack = await deps.readFile(args.file);
    if (readBack === originalContent) {
      throw new RefusalError(
        "Rule 4",
        `Refusal (Rule 4): file ${args.file} did not change after writing mutation`,
      );
    }
    if (readBack !== mutatedContent) {
      throw new RefusalError(
        "Rule 4",
        `Refusal (Rule 4): file ${args.file} does not match intended mutation after writing`,
      );
    }

    // Execute the command
    const execResult = await deps.execute(args.command);

    // Rule 7: The verdict comes from the command's exit code, not from its output.
    // Non-zero means caught; zero means survived.
    const verdict: Verdict = execResult.exitCode !== 0 ? "caught" : "survived";

    return {
      exitCode: execResult.exitCode,
      verdict,
      because: args.because,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      launchError: execResult.launchError,
    };
  } finally {
    // The handlers stay registered until the restore has completed: a signal
    // during the restoring write must still reach the restore, not the default.
    try {
      await restore();
    } finally {
      unregisterSignal?.();
    }
  }
}

export function formatReport(result: MutationResult): string {
  const lines: string[] = [
    `exit code: ${result.exitCode}`,
    `verdict: ${result.verdict}`,
    `because: ${result.because}`,
  ];
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (output.trim().length > 0) {
    lines.push("", output);
  }
  return lines.join("\n");
}
