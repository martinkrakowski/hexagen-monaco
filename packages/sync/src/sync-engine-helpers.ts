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
  dest.deleted.push(...src.deleted);
  dest.unchanged.push(...src.unchanged);
  dest.totalOps += src.totalOps;
  // Surface a failed-soft sub-result instead of dropping it (B-1): before this,
  // a per-module `result.error` vanished in the merge and the run looked
  // converged. First error wins (same rule as apps.ts's local merge); the
  // engine counts failures exactly at the production sites, so this field is
  // visibility, not arithmetic.
  if (src.error && !dest.error) {
    dest.error = src.error;
    dest.summary = src.summary;
  }
}

export function mergeBarrelPasses(
  firstPass: GeneratorResult,
  secondPass: GeneratorResult,
): GeneratorResult {
  const combined = createEmptyResult();
  // Pass-2 records that may evict a pass-1 record for the same path: actual or
  // planned mutations, plus preserve/scope skips. A pass-2 `unchanged` is
  // deliberately NOT in this set — if pass 1 created/updated a barrel and pass 2
  // then found nothing more to do, the run still mutated the file, and the
  // mutation record (which backs totalOps and `sync --check`) must survive.
  const secondPaths = new Set<string>([
    ...secondPass.created,
    ...secondPass.updated,
    ...secondPass.skipped,
    ...secondPass.deleted,
  ]);
  const secondAll = new Set<string>([...secondPaths, ...secondPass.unchanged]);
  const firstMutations = new Set<string>([
    ...firstPass.created,
    ...firstPass.updated,
    ...firstPass.deleted,
  ]);
  for (const p of firstPass.created) {
    if (!secondPaths.has(p)) combined.created.push(p);
  }
  for (const p of firstPass.updated) {
    if (!secondPaths.has(p)) combined.updated.push(p);
  }
  for (const p of firstPass.skipped) {
    if (!secondAll.has(p)) combined.skipped.push(p);
  }
  for (const p of firstPass.deleted) {
    if (!secondPaths.has(p)) combined.deleted.push(p);
  }
  for (const p of firstPass.unchanged) {
    if (!secondAll.has(p)) combined.unchanged.push(p);
  }
  combined.created.push(...secondPass.created);
  combined.updated.push(...secondPass.updated);
  combined.skipped.push(...secondPass.skipped);
  combined.deleted.push(...secondPass.deleted);
  // Mirror of the eviction rule above: drop a pass-2 `unchanged` when pass 1
  // already recorded a mutation for the same path.
  for (const p of secondPass.unchanged) {
    if (!firstMutations.has(p)) combined.unchanged.push(p);
  }
  // Recompute rather than sum the pass totals: under dry-run nothing is
  // written between the passes, so pass 2 re-plans the SAME mutations pass 1
  // planned (e.g. one absent barrel = two planned creates). The buckets above
  // dedup those by path; a summed total would disagree with the table —
  // "Drift detected: 2 pending" over one [DRY-RUN] line — exactly where
  // `sync --check` reads it. Every totalOps increment in the barrel pass is
  // bucket-paired (recordWriteStatus, and the explicit deleted pushes in
  // recursive.ts), so the merged mutation buckets ARE the op count. In a real
  // run the rare created-then-updated path collapses to its net record too —
  // the table and the total stay one source.
  combined.totalOps =
    combined.created.length + combined.updated.length + combined.deleted.length;
  return combined;
}
