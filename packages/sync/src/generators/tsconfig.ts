import path from "node:path";
import { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { MigrationReport } from "../migration-report.js";
import { safeWriteFileAtomic } from "../fs-utils.js";

/**
 * Generates tsconfig.json for each module with proper composite references.
 * Uses safeWriteFile for dry-run safety, protection, and idempotency.
 * No @generated marker (invalid in JSON) — relies on content hash for skipping.
 */
export async function generateTsconfig(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: MigrationReport,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, "tsconfig.json");

  // Don't generate tsconfig references automatically.
  // References create build-order dependencies and can cause circular issues.
  // The monorepo build tool (turbo) handles dependency ordering via package.json dependencies.
  //
  // IMPORTANT: We override "paths" to empty object to prevent inheriting paths from
  // tsconfig.base.json. Without this, TypeScript will try to resolve @hexagen/* imports
  // to source files in other packages, causing TS6059/TS6307 errors about files not
  // being under rootDir.
  const content = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "emitDeclarationOnly": true,
    "composite": true,
    "tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo",
    "paths": {}
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;

  const status = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report as any,
  );
  if (status === "created") result.created.push(filePath);
  if (status === "updated") result.updated.push(filePath);
  if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  result.totalOps += status === "created" || status === "updated" ? 1 : 0;

  return result;
}

export async function generateTsconfigTest(
  moduleDir: string,
  config: SyncConfig,
  report?: MigrationReport,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, "tsconfig.test.json");
  const content = `{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "noEmit": true,
      "composite": false,
      "rootDir": "..",
      "skipLibCheck": true
    },
    "include": [
      "src/**/*.ts",
      "__tests__/**/*.ts",
      "tests/**/*.ts"
    ]
  }`;
  const status = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report as any,
  );
  if (status === "created") result.created.push(filePath);
  if (status === "updated") result.updated.push(filePath);
  if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  result.totalOps += status === "created" || status === "updated" ? 1 : 0;
  return result;
}
