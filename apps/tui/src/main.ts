import { parseTuiArgs } from "./cli-args.js";

export interface MainDeps {
  readonly startBrownfield: (workspaceRoot: string) => void;
  /** Loads and starts the architecture view; only ever reached without `--brownfield`. */
  readonly startGreenfield: () => Promise<void>;
  readonly cwd: string;
  readonly fail: (message: string) => void;
}

const defaultDeps = (): MainDeps => ({
  startBrownfield: (root) => {
    void import("./brownfield/run.js").then((m) => m.startBrownfield(root));
  },
  // Dynamic: this module builds the MCP client at import, which `--brownfield`
  // must never trigger.
  startGreenfield: async () => {
    await import("./greenfield-app.js");
  },
  cwd: process.cwd(),
  fail: (message) => {
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  },
});

export async function main(
  argv: readonly string[],
  deps: MainDeps = defaultDeps(),
): Promise<void> {
  const args = parseTuiArgs(argv, deps.cwd);
  if (args.problem) {
    deps.fail(args.problem);
    return;
  }
  if (args.brownfield) {
    deps.startBrownfield(args.workspaceRoot);
    return;
  }
  await deps.startGreenfield();
}
