import {
  UNRESOLVED_IMPORT_RULE_ID,
  edgesComplete,
  isPathInSlice,
  type Contract,
  type ObservedReport,
  type Slice,
} from "@hexagen/shared";
import { extOf } from "../observe/index.js";
import {
  prefixHasTarget,
  sliceEntryOf,
  underPrefix,
} from "../shared/brownfield-sidecar.js";

export interface Violation {
  rule: string;
  file: string;
  specifier: string;
  severity: "error" | "warn";
}

export interface Evaluation {
  violations: Violation[];
  /**
   * Set when the edge or unresolved sections were not collected: nothing can be
   * said about the slice's imports, so the check is never clean and no baseline
   * can cover it.
   */
  incomplete: string | null;
}

/** Specifier recorded for a file the import pass cannot read. */
export function unreadLanguageSpecifier(ext: string): string {
  return `<unread language: ${ext}>`;
}

/**
 * Rules against the observed edges whose `from` is in the slice, plus the
 * built-in `unresolved-import` rule (plan BW-D3):
 *  - every `unresolved` row whose `from` is in the slice, whatever its reason;
 *  - every in-slice file whose extension is in `edges.unreadLanguages`.
 *
 * `forbid`: an edge from the rule's `from` prefix to its `to` prefix.
 * `allow-only`: an edge from the `from` prefix to anywhere that is neither
 * the `to` prefix nor the `from` prefix itself (same-prefix imports are
 * allowed).
 */
export function evaluateContract(input: {
  slice: Slice;
  contract: Contract | undefined;
  observed: ObservedReport;
  /** Work-tree files (tracked and untracked, not ignored). */
  files: readonly string[];
}): Evaluation {
  const { slice, contract, observed, files } = input;
  const violations: Violation[] = [];
  const { edges, unresolved } = observed;

  let incomplete: string | null = null;
  if (!edges.collected) {
    incomplete = `edges were not collected (${edges.reason})`;
  } else if (!unresolved.collected) {
    incomplete = `unresolved imports were not collected (${unresolved.reason})`;
  }

  if (edges.collected) {
    for (const rule of contract?.rules ?? []) {
      for (const e of edges.items) {
        if (!isPathInSlice(slice, e.from)) continue;
        if (!underPrefix(rule.from, e.from)) continue;
        const hitsTo = prefixHasTarget(rule.to, e.to);
        const bad =
          rule.kind === "forbid"
            ? hitsTo
            : !hitsTo && !prefixHasTarget(rule.from, e.to);
        if (bad) {
          violations.push({
            rule: rule.id,
            file: e.from,
            specifier: e.specifier,
            severity: rule.severity,
          });
        }
      }
    }
  }

  if (unresolved.collected) {
    for (const u of unresolved.items) {
      if (!isPathInSlice(slice, u.from)) continue;
      violations.push({
        rule: UNRESOLVED_IMPORT_RULE_ID,
        file: u.from,
        specifier: u.specifier,
        severity: "error",
      });
    }
  }

  // `unreadLanguages` holds file extensions ("go"), not the display names in
  // `languages[].name` ("Go"): join on the extension.
  if (edges.collected && !edgesComplete(edges)) {
    const unread = new Set(edges.unreadLanguages);
    for (const f of files) {
      if (!isPathInSlice(slice, f)) continue;
      const ext = extOf(f);
      if (!unread.has(ext)) continue;
      violations.push({
        rule: UNRESOLVED_IMPORT_RULE_ID,
        file: f,
        specifier: unreadLanguageSpecifier(ext),
        severity: "error",
      });
    }
  }

  return { violations, incomplete };
}

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Inclusive end-of-day UTC: an entry that expires on date D is still valid
 * throughout that UTC day and expires at D+1 00:00:00.000Z. A copy of
 * `isSuppressionExpired` in `tools/arch-linter/src/ratchet-baseline.ts`
 * (this package does not depend on the linter); a test pins the same cases.
 */
export function isSuppressionExpired(
  expires: string,
  now: Date = new Date(),
): boolean {
  const match = EXPIRES_RE.exec(expires);
  if (!match) {
    throw new Error(
      `'expires' must be YYYY-MM-DD (got ${JSON.stringify(expires)})`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`'expires' is not a real calendar date (${expires})`);
  }
  return now.getTime() > Date.UTC(year, month - 1, day, 23, 59, 59, 999);
}

/** True when a baseline entry covers the violation and has not expired. */
export function isKnown(
  contract: Contract | undefined,
  v: Violation,
  now: Date,
): boolean {
  return (contract?.knownViolations ?? []).some(
    (k) =>
      k.rule === v.rule &&
      k.file === v.file &&
      k.specifier === v.specifier &&
      (k.expires === undefined || !isSuppressionExpired(k.expires, now)),
  );
}

/** Cross-prefix edges inside the slice, deduplicated by prefix pair. */
export function proposeCrossPrefixEdges(
  slice: Slice,
  observed: ObservedReport,
): { from: string; to: string; count: number; example: string }[] {
  if (!observed.edges.collected) return [];
  const pairs = new Map<
    string,
    { from: string; to: string; count: number; example: string }
  >();
  for (const e of observed.edges.items) {
    const from = sliceEntryOf(slice, e.from);
    const to = sliceEntryOf(slice, e.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\0${to}`;
    const hit = pairs.get(key);
    if (hit) hit.count++;
    else {
      pairs.set(key, {
        from,
        to,
        count: 1,
        example: `${e.from} -> ${e.to} (${e.specifier})`,
      });
    }
  }
  return [...pairs.values()];
}
