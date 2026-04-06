#!/usr/bin/env node
import { startDefaultMCPServer } from "./index.js";

const workspaceRoot = process.cwd();

startDefaultMCPServer(workspaceRoot).catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`mcp-server failed to start: ${message}\n`);
  process.exit(1);
});
