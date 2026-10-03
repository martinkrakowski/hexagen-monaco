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

// ── the growth guard ──────────────────────────────────────────────────────────
//
// `hexagen contract check --base <ref>` fails when the working tree has made the
// slice's gate weaker than the contract at `<ref>`. The bypasses it closes are
// all reachable without `--allow-growth`: an entry the base did not have, a date
// pushed later, a date dropped (including the silent drop of `--baseline`), a
// removed rule, a rule downgraded to `warn` (the check fails only on `error`),
// an edit to a rule's `kind`/`from`/`to`, and a new `slice.json` exclude (which
// removes files from the gate before paths are matched).
//
// Kept here, beside `findKnownViolation`, because the identity of a baseline
// entry (rule + file + specifier) is the same one the check judges with. No
// git and no clock: the caller supplies both sides.

/** What kind of weakening a finding is. */
export type ContractGrowthKind =
  | "known-violation-added"
  | "entry-identity-changed"
  | "expires-extended"
  | "expires-dropped"
  | "rule-removed"
  | "rule-field-changed"
  | "exclude-added"
  | "paths-entry-removed"
  | "paths-entry-narrowed";

export interface ContractGrowth {
  kind: ContractGrowthKind;
  /** One printed line, without any `growth: ` prefix. */
  detail: string;
}

/**
 * An `expires` date as an instant, or `undefined` when absent or unreadable.
 * Both sides come from a parsed `Contract` in the CLI, so the schema has already
 * refused an impossible date; a value this cannot read counts as absent, which
 * fails toward growth rather than away from it.
 */
function expiresInstant(date: string | undefined): number | undefined {
  if (date === undefined) return undefined;
  const match = EXPIRES_RE.exec(date);
  if (!match) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** How `entry` names a violation, the triple `findKnownViolation` matches on. */
function entryLabel(entry: Contract["knownViolations"][number]): string {
  return `${entry.rule}  ${entry.file}  ${entry.specifier}`;
}

/** The fields of a rule the guard treats as one edit: any difference is growth. */
const RULE_FIELDS = ["kind", "from", "to", "severity"] as const;

/**
 * The fields of a baseline entry that make it cover what it covers: the triple
 * the check matches on. Any difference is growth, whichever way it points.
 */
const IDENTITY_FIELDS = ["file", "specifier"] as const;

/**
 * Everything the working tree has weakened relative to `base`.
 *
 * Not growth, deliberately: a removed entry, a shortened `expires`, an added
 * rule, a removed exclude, and an added or widened slice `paths` entry. Those
 * are the ratchet moving in the right direction. A `severity` raised from `warn`
 * to `error` is likewise not growth, so it is reported only when it weakens.
 */
export function findContractGrowth(input: {
  contract: Pick<Contract, "rules" | "knownViolations">;
  slice: SlicePaths;
  tree: {
    contract: Pick<Contract, "rules" | "knownViolations"> | undefined;
    slice: SlicePaths;
  };
}): ContractGrowth[] {
  const { contract: base, slice: baseSlice, tree } = input;
  const baseRules = base.rules;
  // No contract in the tree is every rule gone, not a pass.
  const treeRules = tree.contract?.rules ?? [];
  const treeEntries = tree.contract?.knownViolations ?? [];
  const found: ContractGrowth[] = [];

  // The base's entries grouped by rule, so a re-pointed entry can still be found
  // (below) without giving every entry the same rule the same identity.
  const baseByRule = new Map<string, Contract["knownViolations"][number][]>();
  for (const known of base.knownViolations) {
    const same = baseByRule.get(known.rule);
    if (same) same.push(known);
    else baseByRule.set(known.rule, [known]);
  }
  const treePerRule = new Map<string, number>();
  for (const known of treeEntries) {
    treePerRule.set(known.rule, (treePerRule.get(known.rule) ?? 0) + 1);
  }

  for (const entry of treeEntries) {
    // Which base entry is this one? The same triple is the same entry, expiry
    // deliberately ignored: an entry that has expired is still the entry the
    // guard must compare against. Failing that, it can only be a re-pointed
    // entry when neither side holds a second entry for that rule — with several,
    // an edit cannot be attributed to one, and the honest report is a new entry,
    // which is growth all the same.
    const sameRule = baseByRule.get(entry.rule) ?? [];
    const prior =
      sameRule.find(
        (k) => k.file === entry.file && k.specifier === entry.specifier,
      ) ??
      (sameRule.length === 1 && treePerRule.get(entry.rule) === 1
        ? sameRule[0]
        : undefined);
    if (!prior) {
      found.push({
        kind: "known-violation-added",
        detail: `new knownViolations entry ${entryLabel(entry)}`,
      });
      continue;
    }
    // `rule` + `file` + `specifier` IS the entry's coverage key, so an edit to it
    // is reviewed like a rule's `from`/`to` (see RULE_FIELDS): the guard matches
    // the two entries by exact equality, but a wider key — a directory where a
    // file was, a glob where an import was — is the shape that hides more than
    // the base recorded, and nothing here can compare the two coverages. `reason`
    // is a note on the entry, not its coverage, so it is not growth.
    for (const field of IDENTITY_FIELDS) {
      if (entry[field] === prior[field]) continue;
      found.push({
        kind: "entry-identity-changed",
        detail:
          `knownViolations entry ${entryLabel(prior)} ` +
          `${field} changed to ${entry[field]}`,
      });
    }
    const was = expiresInstant(prior.expires);
    const now = expiresInstant(entry.expires);
    if (now !== undefined && now > (was ?? Number.NEGATIVE_INFINITY)) {
      found.push({
        kind: "expires-extended",
        detail:
          `knownViolations entry ${entryLabel(prior)} expires extended ` +
          `${prior.expires ?? "never"} -> ${entry.expires ?? "never"}`,
      });
    } else if (now === undefined && was !== undefined) {
      found.push({
        kind: "expires-dropped",
        detail:
          `knownViolations entry ${entryLabel(prior)} expires dropped ` +
          `(was ${prior.expires ?? "never"})`,
      });
    }
  }

  for (const rule of baseRules) {
    const now = treeRules.find((r) => r.id === rule.id);
    if (!now) {
      found.push({ kind: "rule-removed", detail: `rule ${rule.id} removed` });
      continue;
    }
    for (const field of RULE_FIELDS) {
      if (now[field] === rule[field]) continue;
      // warn -> error is a stricter rule, not a weaker one.
      if (field === "severity" && rule.severity === "warn") continue;
      found.push({
        kind: "rule-field-changed",
        detail: `rule ${rule.id} ${field} changed (${rule[field]} -> ${now[field]})`,
      });
    }
  }

  for (const exclude of tree.slice.excludes) {
    if (baseSlice.excludes.includes(exclude)) continue;
    found.push({
      kind: "exclude-added",
      detail: `new slice exclude ${exclude}`,
    });
  }

  // A `paths` entry is the slice's reach, so losing one is worse than a new
  // exclude: a file under a removed prefix is not judged at all, so nothing is
  // ever reported for it, while an exclude at least leaves the rest of the
  // prefix judged. Narrowing to a longer prefix covers less of the same ground
  // and is the same loss. Widening (a new entry) judges MORE, so it is not
  // growth.
  const treePaths = tree.slice.paths.map(nfc);
  for (const entry of baseSlice.paths) {
    const key = nfc(entry);
    // A tree entry strictly inside the base entry narrows it: the same ground,
    // less of it. `underPrefix` is exact for an entry with no trailing slash, so
    // a file path can never be narrowed this way.
    const narrower = treePaths.find((p) => p !== key && underPrefix(key, p));
    if (narrower !== undefined) {
      found.push({
        kind: "paths-entry-narrowed",
        detail: `slice paths entry ${entry} narrowed (now ${narrower})`,
      });
      continue;
    }
    if (!treePaths.includes(key)) {
      found.push({
        kind: "paths-entry-removed",
        detail: `slice paths entry ${entry} removed`,
      });
    }
  }

  return found;
}
