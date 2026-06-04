#!/usr/bin/env node
// @hexagen-server-only — MCP server entry point.
// Run:  npx tsx bin/cli.ts        (or build → node dist/bin/cli.js)
//
// The side-effect imports populate the tool + transport registries before the
// server starts; order doesn't matter between them, but both must precede
// startServer().
import "../src/infrastructure/mcp/registry/register-all.js";
import "../src/infrastructure/mcp/transport/register-transports.js";
import { startServer } from "../src/infrastructure/mcp/server.js";

startServer().catch((error: unknown) => {
  console.error("[mcp] failed to start:", error);
  process.exit(1);
});
