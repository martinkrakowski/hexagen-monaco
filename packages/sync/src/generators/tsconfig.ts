// packages/sync/src/generators/tsconfig.ts

import path from 'node:path';
import fs from 'node:fs/promises';
import { SyncConfig } from '../config.js';
import { createEmptyResult, type GeneratorResult } from '../results.js';

/**
 * Generates or updates tsconfig.json while preserving references and composite: true.
 * Non-destructive: skips existing files unless --force.
 */
export async function generateTsconfig(
  modulePath: string,
  moduleName: string,
  config: SyncConfig
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const defaults = (config as any).manifest?.workspaceDefaults?.tsconfig || {};
  const moduleOverrides =
    (config as any).manifest?.modules?.find((m: any) => m.name === moduleName)
      ?.tsconfig || {};

  const tsconfigPath = path.join(modulePath, 'tsconfig.json');

  const tsconfigContent = generateTsconfigContent(
    moduleName,
    defaults,
    moduleOverrides
  );

  const fileResult = await writeTsconfigFile(
    tsconfigPath,
    tsconfigContent,
    config.dryRun,
    config.force
  );

  result.created.push(...(fileResult.created ?? []));
  result.skipped.push(...(fileResult.skipped ?? []));
  result.updated.push(...(fileResult.updated ?? []));
  result.dryRunOperations += fileResult.dryRunOperations ?? 0;

  result.summary = `tsconfig.json ensured for ${moduleName}`;
  return result;
}

function generateTsconfigContent(
  moduleName: string,
  defaults: any,
  overrides: any
): string {
  const tsconfig = {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      composite: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      declaration: true,
      outDir: './dist',
      rootDir: './src',
      strict: true,
      noImplicitAny: true,
      strictNullChecks: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      paths: {
        '@hexagen/*': ['../*/src'],
      },
      ...defaults.compilerOptions,
      ...overrides.compilerOptions,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
    references: overrides.references || defaults.references || [],
    ...defaults,
    ...overrides,
  };

  return JSON.stringify(tsconfig, null, 2) + '\n';
}

async function writeTsconfigFile(
  filePath: string,
  content: string,
  dryRun: boolean,
  force: boolean
): Promise<Partial<GeneratorResult>> {
  const r: Partial<GeneratorResult> = {
    created: [],
    skipped: [],
    updated: [],
    dryRunOperations: 0,
  };

  if (dryRun) {
    r.created = [filePath];
    r.dryRunOperations = 1;
    return r;
  }

  // Non-destructive: skip if file already exists (unless --force)
  try {
    await fs.access(filePath);
    r.skipped = [filePath];
    return r;
  } catch {}

  try {
    await fs.writeFile(filePath, content, 'utf8');
    r.created = [filePath];
    return r;
  } catch (err: any) {
    r.error = err;
    return r;
  }
}
