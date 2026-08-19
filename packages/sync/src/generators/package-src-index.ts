import path from "node:path";
import fs from "node:fs/promises";
import type { SyncConfig } from "../config.js";
import type { ReportRecorder } from "../domain/types.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { isInScope, safeWriteFileAtomic } from "../fs-utils.js";
import { GENERATED_MARKER } from "./barrels/utils.js";

/**
 * Package-root entry written when `src/index.ts` is absent.
 *
 * Wave C 6.7(a) stops emitting unused layer folders. CLI `hexagen sync` is
 * `self-regen` (config.ts), so `generateSharedKernel` (external-only) does
 * not run. A freshly scaffolded module then has a tsconfig include
 * of src/ and zero inputs — tsc TS18003. Empty layer `export {}`
 * barrels used to be those inputs; they must not come back.
 *
 * Write-if-absent so this monorepo's hand-maintained package-root barrels
 * are never clobbered. The `@generated` marker lets a later external
 * barrel pass replace this stub with real layer re-exports.
 */
const SRC_INDEX_STUB = `${GENERATED_MARKER}\n\nexport {};\n`;

export async function ensurePackageSrcIndex(
  moduleDir: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const filePath = path.join(moduleDir, "src", "index.ts");

  if (!isInScope(filePath, config)) {
    result.skipped.push(filePath);
    return result;
  }

  try {
    await fs.stat(filePath);
    result.skipped.push(filePath);
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (!config.dryRun) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  }

  const status = await safeWriteFileAtomic(
    filePath,
    SRC_INDEX_STUB,
    config,
    report,
    false,
  );
  recordWriteStatus(result, filePath, status);
  return result;
}
