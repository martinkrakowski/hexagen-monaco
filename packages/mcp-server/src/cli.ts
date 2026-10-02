#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./cli-args.js";
import { startDefaultMCPServer } from "./index.js";
import { GrantSignatureAdapter } from "./infrastructure/adapters/grant-signature.adapter.js";

process.on("uncaughtException", (error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[hexagen-mcp] fatal: uncaught exception: ${message}\n`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(
    `[hexagen-mcp] fatal: unhandled rejection: ${message}\n`,
  );
  process.exit(1);
});

async function validateWorkspaceRoot(workspaceRoot: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(workspaceRoot);
  } catch {
    process.stderr.write(
      `[hexagen-mcp] error: workspace root does not exist: ${workspaceRoot}\n`,
    );
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    process.stderr.write(
      `[hexagen-mcp] error: workspace root is not a directory: ${workspaceRoot}\n`,
    );
    process.exit(1);
  }

  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  try {
    await fs.promises.access(manifestPath);
  } catch {
    process.stderr.write(
      `[hexagen-mcp] warning: .architecture/manifest.yaml not found in ${workspaceRoot}\n`,
    );
  }
}

const {
  workspaceRoot: rawWorkspaceRoot,
  showHelp,
  keyFile,
  engagementId,
} = parseArgs(process.argv.slice(2));
const workspaceRoot = path.resolve(rawWorkspaceRoot);

if (showHelp) {
  process.stderr.write(`Usage: hexagen-mcp [options] [workspace-root]

Options:
  --workspace-root <path>  Monorepo workspace root directory (default: cwd)
  --key-file <path>        Grant-signing key file (default: HEXAGEN_GRANT_KEY_FILE, then
                           ~/.hexagen/keys/<engagement>.key; repo mode keeps
                           <workspace-root>/.hexagen/grant-signing.key)
  --engagement <id>        Engagement id naming the key (default: id in
                           <workspace-root>/.hexagen/slice.json)
  -h, --help               Show this help message

The server communicates via MCP protocol on stdin/stdout.
Diagnostic messages are written to stderr.
`);
  process.exit(0);
}

validateWorkspaceRoot(workspaceRoot)
  .then(() => {
    process.stderr.write(
      `[hexagen-mcp] starting with workspace root: ${workspaceRoot}\n`,
    );
    const grantKeyOptions = { keyFile, engagementId };
    // Say which key grants are verified against (never the key itself). With
    // no manifest and no resolvable key, every grant is denied, and this says why.
    process.stderr.write(
      `[hexagen-mcp] grant key: ${new GrantSignatureAdapter(workspaceRoot, grantKeyOptions).describeKey()}\n`,
    );
    return startDefaultMCPServer(workspaceRoot, grantKeyOptions);
  })
  .catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[hexagen-mcp] failed to start: ${message}\n`);
    process.exit(1);
  });
