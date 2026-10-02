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

export function isKnown(contract: Contract | undefined, v: Violation): boolean {
  return (contract?.knownViolations ?? []).some(
    (k) =>
      k.rule === v.rule && k.file === v.file && k.specifier === v.specifier,
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
