import type { Contract } from "./contract.js";
import type { ObservedReport } from "./observed.js";
import {
  isPathInSlice,
  nfc,
  normalizeSlicePath,
  type SlicePaths,
} from "./slice-path.js";

/**
 * The edge-rule semantics of `hexagen contract check`, kept free of node so the
 * CLI and the browser viewer judge an edge the same way. The CLI's
 * unresolved-import and unread-language checks stay in the CLI.
 */

/** `entry` is a directory prefix (trailing `/`) or an exact file path. */
export function underPrefix(entry: string, candidate: string): boolean {
  // NFC on both sides, as isPathInSlice does, so an exclude bites in either form.
  const e = nfc(entry);
  const c = nfc(candidate);
  return e.endsWith("/") ? c.startsWith(e) : c === e;
}

/**
 * True when `to` (an edge target: a file, or a package root written without a
 * trailing `/`, or `.` for the root package) lies inside the slice. A package
 * root is a directory, so it is also tried with a trailing `/`.
 */
export function targetInSlice(slice: SlicePaths, to: string): boolean {
  if (to === "." || !normalizeSlicePath(to).ok) return false;
  const hit = (entry: string): boolean =>
    underPrefix(entry, to) || underPrefix(entry, `${to}/`);
  // Excludes win under either spelling, then paths.
  if (slice.excludes.some(hit)) return false;
  return slice.paths.some(hit);
}

/** The first slice `paths` entry that contains `p` (a file or package root). */
export function sliceEntryOf(slice: SlicePaths, p: string): string | undefined {
  if (!targetInSlice(slice, p)) return undefined;
  return slice.paths.find((e) => underPrefix(e, p) || underPrefix(e, `${p}/`));
}

/** True when `prefix` (a rule prefix) contains the edge target `to`. */
export function prefixHasTarget(prefix: string, to: string): boolean {
  if (to === ".") return false;
  return underPrefix(prefix, to) || underPrefix(prefix, `${to}/`);
}

export type ObservedEdge = Extract<
  ObservedReport["edges"],
  { collected: true }
>["items"][number];

export type ContractRule = Contract["rules"][number];

/**
 * True when `rule` is broken by `edge`: the edge starts in the slice and under
 * the rule's `from` prefix, and either lands in a `forbid` target, or leaves an
 * `allow-only` prefix for anywhere but the `to` prefix or the `from` prefix
 * itself (same-prefix imports are allowed).
 */
export function edgeViolatesRule(
  slice: SlicePaths,
  rule: ContractRule,
  edge: ObservedEdge,
): boolean {
  if (!isPathInSlice(slice, edge.from)) return false;
  if (!underPrefix(rule.from, edge.from)) return false;
  const hitsTo = prefixHasTarget(rule.to, edge.to);
  return rule.kind === "forbid"
    ? hitsTo
    : !hitsTo && !prefixHasTarget(rule.from, edge.to);
}
