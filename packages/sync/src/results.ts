import path from "node:path";

/**
 * Outcome vocabulary of `safeWriteFileAtomic` (fs-utils.ts). Declared here so
 * every generator routes the same closed set through `recordWriteStatus`
 * below instead of re-spelling the union (pre-B2, every generator hand-rolled
 * its own copy of the routing if-chain and two of them miscounted — see the
 * helper's doc).
 */
export type WriteStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "skipped"
  | "protected";

/**
 * Result shape returned by each individual generator function.
 */
export interface GeneratorResult {
  created: string[];
  skipped: string[];
  updated: string[];
  /**
   * Paths removed (or, under --dry-run, that WOULD be removed) by a generator.
   * Introduced in PR-A2 for the empty-barrel unlink path — deletions were
   * previously miscounted into `created`; surfaced in the engine summary since
   * PR-B2 (truthful counts).
   */
  deleted: string[];
  /**
   * Paths whose generated content already matched on disk byte-for-byte
   * (PR-B2, RCA #5). A converged tree lands everything here — `created`/
   * `updated`/`deleted` mean an actual (or, under --dry-run, a planned)
   * mutation, which is what `sync --check` gates on.
   */
  unchanged: string[];
  totalOps: number;
  summary?: string;
  error?: Error;
}

/**
 * Factory for empty result.
 */
export function createEmptyResult(): GeneratorResult {
  return {
    created: [],
    skipped: [],
    updated: [],
    deleted: [],
    unchanged: [],
    totalOps: 0,
  };
}

/**
 * The kind of drift a generated file is in: missing on disk (`create`),
 * different bytes from the generated output (`update`), or no longer
 * generated (`delete`).
 */
export type DriftAction = "create" | "update" | "delete";

/** One workspace-relative file in `sync --check --json`'s `files` list. */
export interface DriftFile {
  path: string;
  action: DriftAction;
  generator: string;
  reason: string;
}

/**
 * Run-level aggregate returned by `SyncEngine.run()` (PR-B2). Counts sum every
 * generator's buckets; `totalOps` is the number of actual (real run) or planned
 * (--dry-run) mutations — creates + updates + deletes. A converged tree
 * reports `totalOps: 0`, which is exactly what `sync --check` gates on (the
 * CLI exits non-zero iff `totalOps > 0`; the exit-code decision stays in
 * cli.ts per the A1 doctrine — the engine only reports).
 *
 * `errors` counts generators that failed-soft — caught their own exception
 * into `result.error` (the Wave-2e "skip this package, do not abort" contract:
 * tsconfig, eslint, apps, root-files) instead of throwing. A failed generator
 * contributes ZERO ops, so without this count a run that could not even plan a
 * file still printed `Total ops : 0` and exited 0 — errors masqueraded as
 * convergence (PR-B2 review, B-1). The CLI exits non-zero whenever
 * `errors > 0`, on real runs and previews alike; `totalOps` deliberately does
 * NOT include errors (it means "planned mutations", and a failure plans
 * nothing — the two are separate facts and separate exit reasons).
 */
export interface SyncRunSummary {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  totalOps: number;
  /** Generators that caught a failure into `result.error` this run. */
  errors: number;
  /**
   * The root manifest.yaml was absent and the engine synthesized an empty one
   * (the dry-run fallback). A fact, not an op: a plain `--dry-run` preview
   * tolerates it, but a verification gate (`--check`) treats it as a failure —
   * you cannot certify a tree drift-free against a manifest that does not
   * exist. The engine only reports it; the CLI decides the exit code (A1).
   */
  manifestMissing: boolean;
  durationMs: number;
  /**
   * Per-phase wall-clock timings for this run, in ms. `null` means the phase
   * did not run: git status is skipped under `--allow-dirty` or in external
   * mode; preflight and linter are skipped in external mode. A phase that ran
   * and returned early — such as preflight in dry-run — reports a small
   * number, not `null`.
   */
  phaseTimingsMs?: {
    gitStatus: number | null;
    preflight: number | null;
    generators: number;
    linter: number | null;
  };
  /**
   * Per-file drift details, sorted by path then action then generator and
   * workspace-relative. Absent when built without the engine's rows.
   */
  files?: DriftFile[];
}

/**
 * The single routing truth from a write status to the result buckets
 * (PR-B2, RCA #5). Before this helper each generator hand-rolled the same
 * if-chain, and two of them lied: shared-kernel counted updates as `created`
 * and `unchanged` as `skipped`; layer-folders counted directory mkdirs as
 * `created` on every run. Routing rules:
 *
 *   created / updated → their bucket, +1 totalOps (a real or planned change)
 *   unchanged         → `unchanged`, NOT an op (nothing was or would be written)
 *   skipped / protected → `skipped`, NOT an op (deliberately left alone)
 *
 * Deletions don't flow through here — they are not a `safeWriteFileAtomic`
 * outcome; the deleting generator pushes `result.deleted` itself (recursive.ts).
 */
export function recordWriteStatus(
  result: GeneratorResult,
  filePath: string,
  status: WriteStatus,
): void {
  if (status === "created") {
    result.created.push(filePath);
    result.totalOps += 1;
  } else if (status === "updated") {
    result.updated.push(filePath);
    result.totalOps += 1;
  } else if (status === "unchanged") {
    result.unchanged.push(filePath);
  } else {
    // "skipped" | "protected"
    result.skipped.push(filePath);
  }
}

/**
 * Build the per-file drift list from the engine's ordered generator rows.
 * Paths are made workspace-relative (absolute paths resolve against
 * `workspaceRoot`, relative ones pass through) with backslashes normalized to
 * `/`. Entries with the same path+action+generator collapse; the result is
 * sorted by path, then action, then generator using code-point comparison
 * (locale-free).
 */
export function buildDriftFiles(
  rows: ReadonlyArray<readonly [string, GeneratorResult]>,
  workspaceRoot: string,
): DriftFile[] {
  const seen = new Set<string>();
  const files: DriftFile[] = [];
  for (const [generator, result] of rows) {
    const buckets: ReadonlyArray<readonly [DriftAction, readonly string[]]> = [
      ["create", result.created],
      ["update", result.updated],
      ["delete", result.deleted],
    ];
    for (const [action, paths] of buckets) {
      for (const p of paths) {
        const relative = path.isAbsolute(p)
          ? path.relative(workspaceRoot, p)
          : p;
        const relPath = relative.replace(/\\/g, "/");
        const key = `${relPath}\u0000${action}\u0000${generator}`;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push({
          path: relPath,
          action,
          generator,
          reason:
            action === "create"
              ? "missing on disk; sync would create it"
              : action === "update"
                ? "content differs from generated output"
                : "no longer generated; sync would remove it",
        });
      }
    }
  }
  files.sort((a, b) => {
    const byPath = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    if (byPath !== 0) return byPath;
    const byAction = a.action < b.action ? -1 : a.action > b.action ? 1 : 0;
    if (byAction !== 0) return byAction;
    return a.generator < b.generator ? -1 : a.generator > b.generator ? 1 : 0;
  });
  return files;
}
