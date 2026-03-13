#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "node",
  ["packages/sync/dist/cli.js", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    cwd: process.cwd(),
  },
);

process.exit(result.status ?? 0);
