import path from 'node:path';
import { SyncConfig } from '../config.js';
import { createEmptyResult, type GeneratorResult } from '../results.js';
import { safeWriteFile } from '../fs-utils.js';

/**
 * Generates tsconfig.json for each module with proper composite references.
 * Uses safeWriteFile for dry-run safety, protection, and idempotency.
 * No @generated marker (invalid in JSON) — relies on content hash for skipping.
 */
export async function generateTsconfig(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, 'tsconfig.json');

  const content = `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "emitDeclarationOnly": true,
    "composite": true,
    "tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  "references": []
}
`;

  const status = await safeWriteFile(filePath, content, config);

  if (status === 'created') result.created.push(filePath);
  if (status === 'updated') result.updated.push(filePath);
  if (status === 'skipped' || status === 'protected')
    result.skipped.push(filePath);
  result.totalOps += status === 'created' || status === 'updated' ? 1 : 0;

  return result;
}
