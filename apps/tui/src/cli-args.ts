import path from "node:path";

export interface TuiArgs {
  readonly brownfield: boolean;
  /** Absolute. Only meaningful for `--brownfield`; defaults to the cwd. */
  readonly workspaceRoot: string;
  /** Set when the arguments are unusable (e.g. `--workspace-root` with no value). */
  readonly problem?: string;
}

export const USAGE = "Usage: tui [--brownfield [--workspace-root <dir>]]";

/** Parses `--brownfield` and `--workspace-root <dir>` (also `--workspace-root=<dir>`). */
export function parseTuiArgs(argv: readonly string[], cwd: string): TuiArgs {
  let brownfield = false;
  let root: string | undefined;
  let problem: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--brownfield") {
      brownfield = true;
    } else if (arg === "--workspace-root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        problem = "--workspace-root needs a directory";
      } else {
        root = value;
        i += 1;
      }
    } else if (arg.startsWith("--workspace-root=")) {
      root = arg.slice("--workspace-root=".length);
      if (root === "") problem = "--workspace-root needs a directory";
    } else {
      problem ??= `unknown argument: ${arg}`;
    }
  }
  if (root !== undefined && !brownfield) {
    problem ??= "--workspace-root requires --brownfield";
  }
  if (problem !== undefined) problem = `${problem}\n${USAGE}`;
  return {
    brownfield,
    workspaceRoot: path.resolve(cwd, root ?? "."),
    ...(problem ? { problem } : {}),
  };
}
