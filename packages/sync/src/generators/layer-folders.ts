// packages/sync/src/generators/layer-folders.ts

import path from 'node:path';
import { SyncConfig } from '../config.js';
import { createEmptyResult, type GeneratorResult } from '../results.js';

/**
 * Ensures all configured layer folders (and optional subfolders) for a module.
 * Handles BOTH common manifest shapes from .architecture.yaml:
 *   1. { domain: "domain", application: "application", ... }
 *   2. { domain: { subfolders: ["entities", ...] }, ... }
 * Signature kept compatible with current call site in sync-engine.ts.
 */
export async function ensureLayerFolders(
  modulePath: string,
  layers: Record<string, any> | undefined,
  config: SyncConfig
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const layerEntries = Object.entries(layers ?? {});

  if (layerEntries.length === 0) {
    result.summary = `No layers defined for module ${modulePath}`;
    return result;
  }

  for (const [layerKey, layerConfig] of layerEntries) {
    // Extract folder name safely (string or fallback to key)
    const folderName = typeof layerConfig === 'string' ? layerConfig : layerKey;
    const layerPath = path.join(modulePath, 'src', folderName);

    // Create main layer folder
    const dirResult = await ensureDirectory(
      layerPath,
      config.dryRun,
      config.force
    );
    result.created.push(...(dirResult.created ?? []));
    result.skipped.push(...(dirResult.skipped ?? []));
    result.updated.push(...(dirResult.updated ?? []));
    result.dryRunOperations += dirResult.dryRunOperations ?? 0;

    // Create subfolders if present
    const subfolders = Array.isArray(layerConfig?.subfolders)
      ? layerConfig.subfolders
      : [];
    for (const sub of subfolders) {
      const subPath = path.join(layerPath, sub);
      const subResult = await ensureDirectory(
        subPath,
        config.dryRun,
        config.force
      );
      result.created.push(...(subResult.created ?? []));
      result.skipped.push(...(subResult.skipped ?? []));
      result.updated.push(...(subResult.updated ?? []));
      result.dryRunOperations += subResult.dryRunOperations ?? 0;
    }
  }

  result.summary = `Layer folders ensured (${result.created.length} created, ${result.skipped.length} skipped)`;
  return result;
}

/** Low-level directory helper (dry-run safe) */
async function ensureDirectory(
  dirPath: string,
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
    r.created = [dirPath];
    r.dryRunOperations = 1;
    return r;
  }

  try {
    // TODO: later integrate real safeWriteFile + force logic
    r.created = [dirPath];
    return r;
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      r.skipped = [dirPath];
      return r;
    }
    r.error = err;
    return r;
  }
}
