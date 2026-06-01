/**
 * Capstone helper: generate a bare scaffold's root files into a target dir using
 * the real `generateRootFiles` generator — NOT the `hexagen sync` self-regen CLI
 * (which resolves the workspace from the package it lives in; see issue #179).
 *
 * Writes package.json / tsconfig.base.json / turbo.json / .gitignore /
 * .yarnrc.yml / SETUP.md for a project scoped `@acme/*` into argv[2].
 *
 *   tsx scripts/capstone/generate-scaffold.ts <targetDir>
 */
import { generateRootFiles } from "../../packages/sync/src/generators/root-files.js";
import type { SyncConfig } from "../../packages/sync/src/config.js";

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("usage: generate-scaffold.ts <targetDir>");
  process.exit(1);
}

const config: SyncConfig = {
  dryRun: false,
  force: false,
  forceRoot: true, // root files are protected; force their creation
  allowDirty: true,
  strict: false,
  mode: "external",
  logger: {
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    errorWithException: () => {},
  },
  manifest: { system: "acme-app", scope: "acme" },
  workspaceRoot: targetDir,
};

const result = await generateRootFiles(config);
if (result.error) {
  console.error("generateRootFiles failed:", result.error.message);
  process.exit(1);
}
console.log(`scaffold root files written to ${targetDir}`);
