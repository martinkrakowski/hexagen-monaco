import path from 'node:path';
import fs from 'node:fs/promises';
import { SyncConfig } from '../config.js';
import { createEmptyResult, type GeneratorResult } from '../results.js';

/**
 * Generates or updates package.json for each module.
 * Data-driven from manifest.workspaceDefaults + per-module overrides.
 * Returns structured GeneratorResult.
 */
export async function generatePackageJson(
  modulePath: string,
  moduleName: string,
  config: SyncConfig
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const defaults = (config as any).manifest?.workspaceDefaults || {};
  const moduleOverrides =
    (config as any).manifest?.modules?.find((m: any) => m.name === moduleName)
      ?.packageJson || {};

  const pkgPath = path.join(modulePath, 'package.json');

  const pkgContent = generatePackageJsonContent(
    moduleName,
    defaults,
    moduleOverrides
  );

  const fileResult = await writePackageJson(
    pkgPath,
    pkgContent,
    config.dryRun,
    config.force
  );

  result.created.push(...(fileResult.created ?? []));
  result.skipped.push(...(fileResult.skipped ?? []));
  result.updated.push(...(fileResult.updated ?? []));
  result.dryRunOperations += fileResult.dryRunOperations ?? 0;

  result.summary = `package.json ensured for ${moduleName} (${result.created.length} created, ${result.skipped.length} skipped)`;
  return result;
}

/** Generate consistent package.json content */
function generatePackageJsonContent(
  moduleName: string,
  defaults: any,
  overrides: any
): string {
  const pkg = {
    name: `@hexagen/${moduleName}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      lint: 'eslint . --ext .ts',
      typecheck: 'tsc --noEmit',
      ...defaults.scripts,
      ...overrides.scripts,
    },
    dependencies: {
      ...defaults.dependencies,
      ...overrides.dependencies,
    },
    devDependencies: {
      typescript: '^5.0.0',
      ...defaults.devDependencies,
      ...overrides.devDependencies,
    },
    ...defaults,
    ...overrides,
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}

/** Safe write for package.json (idempotent) */
async function writePackageJson(
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

  try {
    const existing = await fs.readFile(filePath, 'utf8').catch(() => null);

    if (existing === content && !force) {
      r.skipped = [filePath];
      return r;
    }

    await fs.writeFile(filePath, content, 'utf8');
    r.updated = [filePath];
    return r;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(filePath, content, 'utf8');
      r.created = [filePath];
      return r;
    }
    r.error = err;
    return r;
  }
}
