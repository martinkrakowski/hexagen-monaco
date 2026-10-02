export function parseArgs(
  args: string[],
  cwd: string = process.cwd(),
): {
  workspaceRoot: string;
  showHelp: boolean;
  keyFile?: string;
  engagementId?: string;
} {
  let showHelp = false;
  let workspaceRoot: string | undefined;
  let keyFile: string | undefined;
  let engagementId: string | undefined;
  // Which value-taking flag the next arg belongs to, if any.
  let pending: "workspace" | "key-file" | "engagement" | undefined;

  const assign = (flag: typeof pending, value: string): void => {
    if (flag === "workspace") workspaceRoot = value;
    else if (flag === "key-file") keyFile = value;
    else if (flag === "engagement") engagementId = value;
  };
  const valueFlags: Record<string, "workspace" | "key-file" | "engagement"> = {
    "--workspace-root": "workspace",
    "--key-file": "key-file",
    "--engagement": "engagement",
  };

  for (const arg of args) {
    if (pending !== undefined) {
      if (arg.startsWith("--") || arg === "-h") {
        // A flag value never swallows the next flag; fall through to parse it.
        pending = undefined;
      } else {
        assign(pending, arg);
        pending = undefined;
        continue;
      }
    }
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg in valueFlags) {
      pending = valueFlags[arg];
      continue;
    }
    for (const [flag, kind] of Object.entries(valueFlags)) {
      if (arg.startsWith(`${flag}=`)) {
        assign(kind, arg.slice(flag.length + 1));
      }
    }
  }

  return {
    workspaceRoot: workspaceRoot ?? cwd,
    showHelp,
    keyFile,
    engagementId,
  };
}
