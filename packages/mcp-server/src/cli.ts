#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./cli-args.js";
import { startDefaultMCPServer } from "./index.js";

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

const { workspaceRoot, showHelp } = parseArgs(process.argv.slice(2));

if (showHelp) {
  process.stderr.write(`Usage: hexagen-mcp [options] [workspace-root]

Options:
  --workspace-root <path>  Monorepo workspace root directory (default: cwd)
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
    return startDefaultMCPServer(workspaceRoot);
  })
  .catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[hexagen-mcp] failed to start: ${message}\n`);
    process.exit(1);
  });
