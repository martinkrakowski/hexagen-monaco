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

  const manifestAny = config.manifest as any;
  const allModules = [
    ...(manifestAny.bounded_contexts?.map((m: any) => m.name) ?? []),
    ...(manifestAny.apps?.map((a: any) => a.name) ?? []),
  ];
  const references = allModules
    .filter((name) => name && name !== moduleName)
    .map((name) => ({ path: `../packages/${name}/tsconfig.json` }));
  const content = `{\n  "extends": "../../tsconfig.base.json",\n  "compilerOptions": {\n    "rootDir": "src",\n    "outDir": "dist",\n    "declaration": true,\n    "emitDeclarationOnly": true,\n    "composite": true,\n    "tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo"\n  },\n  "include": ["src/**/*"],\n  "exclude": ["node_modules", "dist"],\n  "references": ${JSON.stringify(references, null, 2)}\n}\n`;

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
