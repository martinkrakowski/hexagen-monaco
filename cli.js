#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "packages/sync/dist/cli.js");

const result = spawnSync("node", [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});

process.exit(result.status ?? 0);
