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
 * True when an `excludes` entry covers `to` (an edge target), under either
 * spelling. Factored out of `targetInSlice` so the `closed` judgement and the
 * slice check cannot disagree about what an exclude covers.
 */
export function targetExcluded(slice: SlicePaths, to: string): boolean {
  const hit = (entry: string): boolean =>
    underPrefix(entry, to) || underPrefix(entry, `${to}/`);
  return slice.excludes.some(hit);
}

/**
 * True when `to` (an edge target: a file, or a package root written without a
 * trailing `/`, or `.` for the root package) lies inside the slice. A package
 * root is a directory, so it is also tried with a trailing `/`.
 */
export function targetInSlice(slice: SlicePaths, to: string): boolean {
  if (to === "." || !normalizeSlicePath(to).ok) return false;
  // Excludes win under either spelling, then paths.
  if (targetExcluded(slice, to)) return false;
  const hit = (entry: string): boolean =>
    underPrefix(entry, to) || underPrefix(entry, `${to}/`);
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
 * True when `rule` is broken by `edge`:
 *  - `closed`: the edge starts in the slice and lands neither in the slice nor
 *    under one of the rule's `except` prefixes. The slice is the `from` side, so
 *    the rule carries no `from`/`to`; `except[]` is the whole escape hatch, so
 *    two accepted crossings out of one source are one rule. Excludes still win:
 *    an except cannot re-open an excluded target.
 *  - `forbid`: the edge starts in the slice and under the rule's `from` prefix
 *    and lands in its `to` prefix.
 *  - `allow-only`: the edge starts in the slice and under the rule's `from`
 *    prefix and leaves it for anywhere but the `to` prefix or the `from` prefix
 *    itself (same-prefix imports are allowed).
 */
export function edgeViolatesRule(
  slice: SlicePaths,
  rule: ContractRule,
  edge: ObservedEdge,
): boolean {
  if (!isPathInSlice(slice, edge.from)) return false;
  if (rule.kind === "closed") {
    if (targetInSlice(slice, edge.to)) return false;
    if (targetExcluded(slice, edge.to)) return true;
    return !rule.except.some((entry) => prefixHasTarget(entry, edge.to));
  }
  if (!underPrefix(rule.from, edge.from)) return false;
  const hitsTo = prefixHasTarget(rule.to, edge.to);
  return rule.kind === "forbid"
    ? hitsTo
    : !hitsTo && !prefixHasTarget(rule.from, edge.to);
}

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Inclusive end-of-day UTC: an entry that expires on date D is still valid
 * throughout that UTC day and expires at D+1 00:00:00.000Z. The caller picks
 * the clock: the CLI passes the wall clock, the viewer the bundle's date.
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

/** The baseline entry that covers the violation and has not expired at `now`, if any. */
export function findKnownViolation(
  contract: Pick<Contract, "knownViolations"> | undefined,
  v: { rule: string; file: string; specifier: string },
  now: Date,
): Contract["knownViolations"][number] | undefined {
  return (contract?.knownViolations ?? []).find(
    (k) =>
      k.rule === v.rule &&
      k.file === v.file &&
      k.specifier === v.specifier &&
      (k.expires === undefined || !isSuppressionExpired(k.expires, now)),
  );
}

/** True when a baseline entry covers the violation and has not expired at `now`. */
export function isKnown(
  contract: Pick<Contract, "knownViolations"> | undefined,
  v: { rule: string; file: string; specifier: string },
  now: Date,
): boolean {
  return findKnownViolation(contract, v, now) !== undefined;
}
