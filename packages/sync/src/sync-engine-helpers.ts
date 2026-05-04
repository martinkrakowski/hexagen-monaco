import { createEmptyResult, type GeneratorResult } from "./results.js";

export interface GeneratorResults {
  rootFiles: GeneratorResult;
  archFiles: GeneratorResult;
  barrels: GeneratorResult;
  pkgs: GeneratorResult;
  tsconfigs: GeneratorResult;
  eslint: GeneratorResult;
  stubs: GeneratorResult;
  apps: GeneratorResult;
  totalOps: number;
}

export function mergeResult(dest: GeneratorResult, src: GeneratorResult): void {
  dest.created.push(...src.created);
  dest.updated.push(...src.updated);
  dest.skipped.push(...src.skipped);
  dest.totalOps += src.totalOps;
}

export function mergeBarrelPasses(
  firstPass: GeneratorResult,
  secondPass: GeneratorResult,
): GeneratorResult {
  const combined = createEmptyResult();
  const secondPaths = new Set<string>([
    ...secondPass.created,
    ...secondPass.updated,
    ...secondPass.skipped,
  ]);
  for (const p of firstPass.created) {
    if (!secondPaths.has(p)) combined.created.push(p);
  }
  for (const p of firstPass.updated) {
    if (!secondPaths.has(p)) combined.updated.push(p);
  }
  for (const p of firstPass.skipped) {
    if (!secondPaths.has(p)) combined.skipped.push(p);
  }
  combined.created.push(...secondPass.created);
  combined.updated.push(...secondPass.updated);
  combined.skipped.push(...secondPass.skipped);
  combined.totalOps = firstPass.totalOps + secondPass.totalOps;
  return combined;
}
