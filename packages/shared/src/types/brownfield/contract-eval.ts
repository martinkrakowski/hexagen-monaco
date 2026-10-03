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

/** True when two entries name the same violation, expiry aside. */
function sameIdentity(
  a: Contract["knownViolations"][number],
  b: Contract["knownViolations"][number],
): boolean {
  return a.rule === b.rule && a.file === b.file && a.specifier === b.specifier;
}

/** The identity of an entry, for grouping. A space cannot appear in any part. */
function identityKey(entry: Contract["knownViolations"][number]): string {
  return `${entry.rule} ${entry.file} ${entry.specifier}`;
}

/** True when `a` suppresses for longer than `b`: no date at all covers most. */
function coversMore(
  a: Contract["knownViolations"][number],
  b: Contract["knownViolations"][number],
): boolean {
  const left = expiresInstant(a.expires);
  const right = expiresInstant(b.expires);
  if (left === right) return false;
  if (left === undefined) return true;
  if (right === undefined) return false;
  return left > right;
}

/**
 * The fields of a baseline entry that make it cover what it covers: the triple
 * the check matches on. Any difference is growth, whichever way it points.
 */
const IDENTITY_FIELDS = ["file", "specifier"] as const;

/**
 * The edits that make `tree` judge less than `base` under one rule id, as
 * printed lines.
 *
 * `kind` first, because a `closed` rule and a prefix rule judge different edge
 * sets — one is the slice with an `except` list, the other a prefix pair — and
 * there is no comparison to make between them. So neither direction can be shown
 * to be the stricter, and a kind change is always growth.
 *
 * `from`/`to` are read only after both rules are known to be prefix kinds, and
 * `except` only after both are known to be `closed`; that is also why the
 * comparison is written out per kind rather than driven off a field list.
 */
function ruleGrowth(base: ContractRule, tree: ContractRule): string[] {
  const found: string[] = [];
  const downgraded = base.severity === "error" && tree.severity === "warn";
  if (base.kind !== tree.kind) {
    // `closed` and a prefix rule judge different edge sets, and `forbid` and
    // `allow-only` judge opposite ones, so neither direction can be shown to be
    // the stricter.
    found.push(`kind changed (${base.kind} -> ${tree.kind})`);
    if (downgraded) found.push("severity changed (error -> warn)");
    return found;
  }
  // Both kinds are known now, so each branch narrows both rules before it reads
  // a field its variant may not carry.
  if (base.kind === "closed" && tree.kind === "closed") {
    // `except` is the whole escape hatch, so more of it allows more crossings:
    // the mirror image of a slice `paths` entry, where more judges more.
    found.push(...exceptGrowth(base.except, tree.except));
  } else if (base.kind !== "closed" && tree.kind !== "closed") {
    if (base.from !== tree.from) {
      found.push(`from changed (${base.from} -> ${tree.from})`);
    }
    if (base.to !== tree.to)
      found.push(`to changed (${base.to} -> ${tree.to})`);
  }
  if (downgraded) found.push("severity changed (error -> warn)");
  return found;
}

/**
 * True when `tree` judges at least as much as `base` under the same rule id.
 * Kinds must match, `from`/`to` must be identical — those are compared bluntly,
 * the guard cannot compare two prefixes — `except` must accept at least as much,
 * and `severity` may not be lowered from `error` to `warn`.
 */
function judgesAtLeastAsMuch(base: ContractRule, tree: ContractRule): boolean {
  if (base.severity === "error" && tree.severity === "warn") return false;
  if (base.kind === "closed" && tree.kind === "closed") {
    return exceptGrowth(base.except, tree.except).length === 0;
  }
  if (base.kind !== "closed" && tree.kind !== "closed") {
    // `forbid` and `allow-only` judge opposite edges, so they are not
    // interchangeable either.
    return (
      base.kind === tree.kind && base.from === tree.from && base.to === tree.to
    );
  }
  // Kinds differ: strictness cannot be proven, so it never cancels a base rule.
  return false;
}

/**
 * The `except` prefixes a `closed` rule adds relative to the base, as printed
 * lines. FEWER prefixes accept fewer crossings, so a tree list that accepts at
 * least as much is not growth: an added or widened prefix is, a removed or
 * narrowed one is not.
 *
 * Matched as a multiset with prefix overlap — one tree prefix can stand for
 * several base prefixes, and each tree prefix is used once — so a base prefix
 * with no partner is a removal (not growth) and only unpaired tree prefixes are
 * additions.
 */
function exceptGrowth(
  base: readonly string[],
  tree: readonly string[],
): string[] {
  const found: string[] = [];
  const paired = new Set<number>();
  for (const entry of base) {
    let at = -1;
    for (let i = 0; i < tree.length; i++) {
      if (paired.has(i)) continue;
      // Any related prefix stands for this one: the same prefix, a parent (which
      // accepts more) or a child (which accepts less). An unrelated prefix is
      // not a partner — it is a different crossing being allowed.
      if (
        tree[i] === entry ||
        underPrefix(tree[i]!, entry) ||
        underPrefix(entry, tree[i]!)
      ) {
        at = i;
        break;
      }
    }
    // No partner at all: the prefix is gone, which accepts less. Not growth.
    if (at === -1) continue;
    paired.add(at);
    // A strictly shorter prefix accepts everything this one did, and more.
    // `underPrefix` alone is not enough: a prefix contains itself.
    if (tree[at] !== entry && underPrefix(tree[at]!, entry)) {
      found.push(`except widened (${entry} -> ${tree[at]})`);
    }
  }
  // Only an unpaired tree prefix is new. A narrowed one is already paired above.
  for (let i = 0; i < tree.length; i++) {
    if (paired.has(i)) continue;
    found.push(`except added ${tree[i]}`);
  }
  return found;
}

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

  // The base's entries grouped by rule and identity, each with a `taken` flag so
  // one base entry can only cancel one tree entry. Two entries can share an
  // identity, so pairing on the first match would compare every tree entry
  // against the same base entry.
  interface BaseSlot {
    entry: Contract["knownViolations"][number];
    taken: boolean;
  }
  const baseByRule = new Map<string, BaseSlot[]>();
  for (const known of base.knownViolations) {
    const same = baseByRule.get(known.rule);
    if (same) same.push({ entry: known, taken: false });
    else baseByRule.set(known.rule, [{ entry: known, taken: false }]);
  }
  const treePerRule = new Map<string, number>();
  for (const known of treeEntries) {
    treePerRule.set(known.rule, (treePerRule.get(known.rule) ?? 0) + 1);
  }
  const baseIdentities = new Set(base.knownViolations.map(identityKey));
  /** The untaken base entry for `entry`'s identity that matches `keep` best. */
  const take = (
    slots: BaseSlot[],
    keep: (k: Contract["knownViolations"][number]) => boolean,
  ): Contract["knownViolations"][number] | undefined => {
    // The strongest first, so the entry a duplicate fails to cancel is the one
    // that covers most, and a date is judged against the longest cover the base
    // still has.
    let best: BaseSlot | undefined;
    for (const slot of slots) {
      if (slot.taken || !keep(slot.entry)) continue;
      if (!best || coversMore(slot.entry, best.entry)) best = slot;
    }
    if (best) best.taken = true;
    return best?.entry;
  };

  for (const entry of treeEntries) {
    // Which base entry does this one pair with? The strongest untaken entry for
    // the same identity, so an exact duplicate cancels out however many the base
    // holds: a base holding a dated entry and then a permanent duplicate, with
    // the dated one removed, leaves a suppression that covers more, not a
    // dropped expiry. Failing that, a re-pointed entry when neither side holds a
    // second entry for that rule — with several, an edit cannot be attributed,
    // and the honest report is a new entry, which is growth all the same.
    const sameRule = baseByRule.get(entry.rule) ?? [];
    const prior =
      take(sameRule, (k) => sameIdentity(k, entry)) ??
      (sameRule.length === 1 && treePerRule.get(entry.rule) === 1
        ? sameRule[0]!.entry
        : undefined);
    if (!prior) {
      // The base already lists this violation, so this entry is a duplicate on
      // top of it: more suppression for the same key is not growth. An identity
      // the base never listed is a new baseline entry, which is.
      if (baseIdentities.has(identityKey(entry))) continue;
      found.push({
        kind: "known-violation-added",
        detail: `new knownViolations entry ${entryLabel(entry)}`,
      });
      continue;
    }
    // `rule` + `file` + `specifier` IS the entry's coverage key, so an edit to it
    // is reviewed like a rule field (see ruleGrowth): the guard matches
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
    // `was === undefined` means the base never expires, which is the strongest
    // suppression there is: a dated tree entry then hides LESS, never more.
    if (now !== undefined && was !== undefined && now > was) {
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

  // The tree's rules, each usable once. The schema allows two rules to share an
  // id, so a rule is paired with a tree rule it can be matched against rather
  // than with the first one that happens to carry its id.
  const matched = new Set<number>();
  for (const rule of baseRules) {
    let asStrict = -1;
    let sameId = -1;
    for (let i = 0; i < treeRules.length; i++) {
      if (matched.has(i) || treeRules[i]!.id !== rule.id) continue;
      if (sameId === -1) sameId = i;
      if (judgesAtLeastAsMuch(rule, treeRules[i]!)) {
        asStrict = i;
        break;
      }
    }
    // A tree rule that judges at least as much cancels this one out, whichever
    // of two rules sharing an id it happens to be.
    if (asStrict !== -1) {
      matched.add(asStrict);
      continue;
    }
    if (sameId === -1) {
      found.push({ kind: "rule-removed", detail: `rule ${rule.id} removed` });
      continue;
    }
    matched.add(sameId);
    const now = treeRules[sameId]!;
    // ruleGrowth narrows on kind before it reads from/to or except, so the
    // union is never indexed by a field the variant may not carry.
    for (const detail of ruleGrowth(rule, now)) {
      found.push({
        kind: "rule-field-changed",
        detail: `rule ${rule.id} ${detail}`,
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
