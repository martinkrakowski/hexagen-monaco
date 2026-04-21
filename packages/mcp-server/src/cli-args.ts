export function parseArgs(
  args: string[],
  cwd: string = process.cwd(),
): { workspaceRoot: string; showHelp: boolean } {
  let showHelp = false;
  let nextArgIsWorkspaceRoot = false;
  let workspaceRoot: string | undefined;

  for (const arg of args) {
    if (nextArgIsWorkspaceRoot) {
      workspaceRoot = arg;
      nextArgIsWorkspaceRoot = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--workspace-root") {
      nextArgIsWorkspaceRoot = true;
      continue;
    }
    if (arg.startsWith("--workspace-root=")) {
      workspaceRoot = arg.slice("--workspace-root=".length);
      continue;
    }
  }

  return {
    workspaceRoot: workspaceRoot ?? cwd,
    showHelp,
  };
}
