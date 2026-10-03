import {
  UNRESOLVED_IMPORT_RULE_ID,
  edgeViolatesRule,
  edgesComplete,
  isPathInSlice,
  prefixHasTarget,
  targetExcluded,
  targetInSlice,
  type Contract,
  type ObservedReport,
  type Slice,
} from "@hexagen/shared";
import { extOf } from "../observe/index.js";
import { sliceEntryOf } from "../shared/brownfield-sidecar.js";

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
 * `closed`: the slice is the rule's `from` side, so an edge from anywhere in
 * the slice to a target that is neither inside the slice nor under one of the
 * rule's `except` prefixes (an exclude still wins over an except).
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
        if (edgeViolatesRule(slice, rule, e)) {
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

// The expiry and baseline-match rules live in @hexagen/shared.
export { isSuppressionExpired, isKnown } from "@hexagen/shared";

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

export interface ClosedProposal {
  /** Except entries, in the order `observed.json` lists them. */
  excepts: string[];
  /** Crossings that get no entry, each with the advice that would accept it. */
  notProposed: { to: string; advice: string }[];
}

/**
 * The `except` list a `closed` rule would need to accept the crossings the
 * observed edges already make: every edge target that leaves the slice, emitted
 * exactly as `slice check` prints it, deduplicated.
 *
 * A target is never turned into a directory. `observed.json` types `to` as a
 * slice path, so a hand-edited report may spell a package root as a directory
 * (`outside/pkg/`); emitting that verbatim gives an except entry which accepts
 * every edge under it, and dropping the slash gives an exact entry which does
 * not match the target at all (`underPrefix` compares equality without a
 * trailing `/`). Neither names the one crossing that was observed, so such a
 * target is reported with the flag that would accept it instead.
 *
 * A crossing no `except` can accept is reported the same way, because a rule
 * naming one would still fail: `.` is never inside a prefix, and an `excludes`
 * entry beats any except.
 */
export function proposeClosedExcepts(
  slice: Slice,
  observed: ObservedReport,
): ClosedProposal {
  const excepts: string[] = [];
  const notProposed: ClosedProposal["notProposed"] = [];
  if (!observed.edges.collected) return { excepts, notProposed };
  const seen = new Set<string>();
  for (const e of observed.edges.items) {
    if (!isPathInSlice(slice, e.from)) continue;
    if (targetInSlice(slice, e.to)) continue;
    if (seen.has(e.to)) continue;
    seen.add(e.to);
    if (e.to === ".") {
      notProposed.push({
        to: e.to,
        advice: "the root package is never inside a prefix",
      });
    } else if (targetExcluded(slice, e.to)) {
      notProposed.push({
        to: e.to,
        advice: "an excludes entry wins over any except",
      });
    } else if (e.to.endsWith("/")) {
      notProposed.push({
        to: e.to,
        advice: `a directory target: an exact entry would not match it, and --except ${e.to} accepts every edge under it, so name it yourself`,
      });
    } else {
      excepts.push(e.to);
    }
  }
  return { excepts, notProposed };
}

/**
 * The warning a `closed` rule earns when ITS OWN `except` list covers every
 * observed package outside the slice: that rule then accepts every crossing it
 * could have refused, so the slice is not closed.
 *
 * One rule, never a pool. Rules are ANDed (`edgeViolatesRule` answers one
 * boolean per rule, and `evaluateContract` raises a violation for each rule an
 * edge breaks), so an edge has to pass every one of them. Two rules that between
 * them cover the whole repo leave each edge with one rule still to fail, which
 * is exactly what a closed slice wants; pooling their lists would warn about a
 * slice that is still shut.
 *
 * Coverage is asked per package root, and it means the root lies UNDER an entry:
 * `--except apps/` covers `apps/web` and `apps/admin`, while `--except apps/web/ui/`
 * covers neither the rest of its own package nor any sibling. An entry without a
 * trailing `/` is an exact file (`underPrefix`), so a bare name covers nothing
 * below it.
 *
 * A package the slice occupies, and one an `excludes` entry denies, are not
 * units to cover: an except opens neither, so no crossing through them could be
 * accepted either. The root package (`.`) is the repo, not a package an except
 * can name.
 */
export function closedRuleCoverageWarning(
  slice: Slice,
  observed: ObservedReport,
  rules: readonly Contract["rules"][number][],
): string | null {
  const outside = packageRootsOutsideSlice(slice, observed);
  if (outside.length === 0) return null;
  let offender: string | undefined;
  for (const rule of rules) {
    if (rule.kind !== "closed") continue;
    if (
      outside.every((root) => rule.except.some((e) => prefixHasTarget(e, root)))
    ) {
      offender = rule.id;
      break;
    }
  }
  if (offender === undefined) return null;
  return `warning: closed rule "${offender}" excepts every package outside the slice (${outside.join(", ")}), so it accepts every crossing: the slice is not closed`;
}

/** Sorted observed package roots that are neither inside the slice nor excluded. */
function packageRootsOutsideSlice(
  slice: Slice,
  observed: ObservedReport,
): string[] {
  if (!observed.packages.collected) return [];
  const roots = new Set<string>();
  for (const pkg of observed.packages.items) {
    if (pkg.root === ".") continue;
    // Package level, not top-level directory: `apps/web` and `apps/admin` share
    // a top-level directory, and a slice that starts inside `apps` must not hide
    // the siblings outside it.
    if (targetInSlice(slice, pkg.root) || targetExcluded(slice, pkg.root)) {
      continue;
    }
    roots.add(pkg.root);
  }
  return [...roots].sort();
}
