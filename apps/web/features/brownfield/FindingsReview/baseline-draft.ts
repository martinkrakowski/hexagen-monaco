/**
 * S5 findings review — the pure baseline transforms (F-19, BF-4.4).
 *
 * NO React, NO fetch, NO storage, NO `Date.now()` read behind the caller's
 * back. Every function here is a total function over plain data, which is why
 * the whole "which debt am I accepting?" model can be exercised without a DOM
 * and why `FindingsReviewView` is left with nothing to decide.
 *
 * ## What this screen actually does
 *
 * `hexagen-lint` partitions every violation against the baseline file into
 * four buckets (`partitionAgainstBaseline` in
 * `tools/arch-linter/src/ratchet-baseline.ts`). Only ONE of them is a
 * decision the user makes here:
 *
 *  - `fresh`     — reproduces, is not suppressed, FAILS the gate today. These
 *                  are the rows in the decision table below.
 *  - `baselined` — reproduces and is already suppressed. Debt accepted on a
 *                  previous run; nothing to decide, counted only.
 *  - `stale`     — a baseline entry with no matching violation. The finding is
 *                  fixed; the entry should be deleted. Not actionable here.
 *  - `expired`   — a baseline entry whose `expires` date has passed. It fails
 *                  the gate WHETHER OR NOT the finding still reproduces.
 *
 * The last two are advisories (`buildFindingsAdvisories`), deliberately not
 * folded into the decision rows: a finding the user cannot act on is a
 * different kind of object from one they are choosing to accept, and a single
 * flat list would invite them to "decide" about entries this screen cannot
 * change.
 *
 * ## Baselining is accepting debt
 *
 * A baselined finding stops failing CI. That is the entire consequence, and
 * the model makes it hard to do accidentally and hard to do silently:
 *
 *  - the default for every row is NOT baselined (`buildFindingsReviewRows`).
 *    The deliberate act is the debt-accepting one, never the enforcing one;
 *  - `reason` is required to baseline. This is not a UX preference —
 *    `parseBaseline` throws on an entry with an empty or missing `reason`
 *    (`entry N has empty or non-string 'reason'`), so a reasonless entry
 *    produces a baseline file the linter refuses to read;
 *  - there is deliberately NO repo-wide "baseline everything". See
 *    `baselineRuleGroup` for the full argument.
 *
 * ## Why the baseline entry shape is declared here and not imported
 *
 * `BaselineEntry` lives in `tools/arch-linter/src/ratchet-baseline.ts`, which
 * is not an `apps/web` dependency and is not published from any `@hexagen/*`
 * barrel this app resolves. The shapes below mirror it field for field
 * (`rule` / `file` / `specifier` / `reason` / `expires`, and no other key —
 * `parseBaselineEntry` rejects unknown fields outright), and the ordering and
 * omission rules mirror `serializeBaseline` / `persistableEntry` so the draft
 * this screen produces is byte-comparable with what the CLI would have
 * written. Same precedent as `DetectedPackageSummary` in
 * `../LayoutRatify/layout-draft.ts`.
 */
import type { ScanFinding, ScanFindings } from "@/lib/project-scan/types";
import type { BrownfieldFinding } from "../BrownfieldFlow/types";

/**
 * The baseline schema version this screen writes. Mirrors `BASELINE_VERSION`
 * in the linter, which refuses any other value (`unsupported baseline version
 * N`). Stated as a named constant so a future bump has one place to land.
 */
export const BROWNFIELD_BASELINE_VERSION = 1;

/**
 * NUL joins the three identity fields, exactly as the linter's own
 * `violationKey` does. Matching that spelling is the point: BF-6.x has to
 * correlate a ratified decision back to a linter record, and two key
 * derivations that "should" agree are two key derivations that eventually do
 * not.
 *
 * NUL cannot occur in a rule id, a repo path or a module specifier, so the key
 * is unambiguous whatever the fields contain. It is an identity string only —
 * never rendered, and never used as a DOM `id` (the view indexes ids
 * positionally, the way `EntityDataGrid` does).
 */
const KEY_SEPARATOR = "\u0000";

/** Stable identity for one finding. Mirrors the linter's `violationKey`. */
export function findingKey(finding: {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
}): string {
  return `${finding.rule}${KEY_SEPARATOR}${finding.file}${KEY_SEPARATOR}${finding.specifier}`;
}

/**
 * What the scan is able to tell this screen about findings.
 *
 * THREE arms, not two, because `ProjectScanResponse.findings` has three
 * meaningful states and collapsing any pair of them produces a false green:
 *
 *  - `collected`     — the CLI read the buckets. Numbers can be trusted, and
 *                      zero fresh findings really does mean zero.
 *  - `not-collected` — the CLI tried and could not (`collected: false`, which
 *                      the wire type forces to carry a `failureReason`).
 *  - `not-reported`  — the field was absent or null. An older `hexagen` on the
 *                      server's PATH emits an envelope without it, and a
 *                      response assembled before the CLI ran has none either.
 *
 * Neither failure arm is "0 findings", and neither may be ratified as a clean
 * tree — see `validateFindingsReview`, which blocks on both.
 */
export type FindingsReviewSource =
  | {
      readonly kind: "collected";
      readonly fresh: readonly BrownfieldFinding[];
      readonly baselined: readonly ScanFinding[];
      readonly stale: readonly ScanFinding[];
      readonly expired: readonly ScanFinding[];
    }
  | { readonly kind: "not-collected"; readonly failureReason: string }
  | { readonly kind: "not-reported" };

/**
 * Normalises the wire field into the three-arm source above.
 *
 * `undefined` and `null` are both `not-reported`: `findings` is optional on
 * `ProjectScanResponse` and is documented there as "not reported", which is
 * emphatically not the same claim as `{ collected: false }`.
 *
 * A `not-collected` payload with a blank `failureReason` still reads as a
 * failure — the reason is replaced with a stand-in sentence rather than being
 * allowed to render as an empty explanation, because an unexplained failure
 * shown as blank space is how a failure gets mistaken for a pass.
 */
export function readScanFindings(
  findings: ScanFindings | null | undefined,
): FindingsReviewSource {
  if (findings === null || findings === undefined) {
    return { kind: "not-reported" };
  }
  if (!findings.collected) {
    const stated = findings.failureReason.trim();
    return {
      kind: "not-collected",
      failureReason: stated === "" ? "the scan gave no reason" : stated,
    };
  }
  return {
    kind: "collected",
    fresh: findings.fresh,
    baselined: findings.baselined,
    stale: findings.stale,
    expired: findings.expired,
  };
}

/**
 * One fresh finding plus the decision the user is making about it.
 *
 * `reason` and `expires` are stored AS TYPED (no trimming, no coercion): a
 * validator that silently repaired input would make the error message a lie
 * about what is in the field. Normalisation happens once, in `toBaselineDraft`.
 */
export interface FindingsReviewRow {
  /** `findingKey(...)`. Row identity and React key. */
  readonly key: string;
  readonly rule: string;
  readonly file: string;
  /** `""` for findings that are not import-scoped. */
  readonly specifier: string;
  /** Display-only text from the linter. Never part of the key. */
  readonly message: string;
  /** The decision. `false` = leave it failing the gate. */
  readonly baselined: boolean;
  readonly reason: string;
  /** `YYYY-MM-DD`, or `""` for an open-ended suppression. */
  readonly expires: string;
  /**
   * Set when this exact finding was already baselined and the suppression
   * LAPSED — the date it lapsed on.
   *
   * Not a guess: `partitionAgainstBaseline` removes expired entries from the
   * active baseline before matching, so a violation whose suppression expired
   * lands in `fresh` AND its old entry lands in `expired`. That means the user
   * is being asked to re-accept debt they accepted once before, and saying so
   * is the difference between an informed renewal and a surprise.
   */
  readonly lapsedOn: string | null;
}

export interface FindingsReviewRuleGroup {
  readonly rule: string;
  readonly rows: readonly FindingsReviewRow[];
  readonly baselinedCount: number;
}

export type FindingsRowMessageSeverity = "error" | "warning";

export interface FindingsRowMessage {
  readonly severity: FindingsRowMessageSeverity;
  readonly text: string;
}

export interface FindingsReviewValidation {
  /** Fresh findings under review. */
  readonly totalCount: number;
  /** Rows the user has marked to baseline. */
  readonly baselinedCount: number;
  /** Rows left alone — these keep failing the gate. */
  readonly enforcedCount: number;
  /** Baselined rows carrying an `expires` date. */
  readonly expiringCount: number;
  readonly errorCount: number;
  /** Per-row inline message, keyed by `key`. Absent = nothing to say. */
  readonly rowMessages: Readonly<Record<string, FindingsRowMessage>>;
  /**
   * Why "Continue" must stay disabled, phrased for the user, or `null` when it
   * may be enabled. A sentence rather than a boolean, for the same reason as
   * on S3: a disabled button with no stated reason is the worst version of
   * this screen.
   */
  readonly blockingReason: string | null;
}

/** Read-only bucket counts, for the summary pills. */
export interface FindingsSourceCounts {
  readonly fresh: number;
  readonly baselined: number;
  readonly stale: number;
  readonly expired: number;
}

export type FindingsAdvisoryKind = "stale" | "expired";

/**
 * A baseline entry the user cannot act on from this screen.
 *
 * Carries FINISHED COPY (`consequence`) rather than a code the view switches
 * on, so the "what does this mean for me?" sentence has exactly one home and
 * can be asserted in a test that needs no DOM.
 */
export interface FindingsAdvisory {
  readonly key: string;
  readonly kind: FindingsAdvisoryKind;
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
  readonly reason: string;
  readonly expires: string;
  readonly consequence: string;
}

/** One entry of the baseline file, as this screen produces it. */
export interface BrownfieldBaselineEntryDraft {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
  /** Always present and always non-empty — `parseBaseline` rejects otherwise. */
  readonly reason: string;
  /** Omitted entirely for an open-ended suppression. */
  readonly expires?: string;
}

/** S5 output — the `.architecture/arch-lint-baseline.json` payload. */
export interface BrownfieldBaselineDraft {
  readonly version: number;
  readonly entries: readonly BrownfieldBaselineEntryDraft[];
}

// ─── date handling ────────────────────────────────────────────────────────────

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD`, and a date that actually exists. Mirrors the linter's
 * `parseExpiresDate`, including its rejection of impossible calendar dates
 * (`2026-02-30` matches the shape and is still not a day).
 *
 * Returns a boolean rather than throwing: this is called per keystroke from a
 * render path, and a validator that throws on half-typed input cannot be.
 */
export function isValidExpiryDate(value: string): boolean {
  return parseExpiryDate(value) !== null;
}

/**
 * `YYYY-MM-DD` -> its three numbers, or `null` when the string is not a real
 * calendar date. Both public date predicates go through this one parse, so
 * "is it valid?" and "has it lapsed?" can never disagree about a given string.
 */
function parseExpiryDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = EXPIRES_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * True when a suppression dated `value` has already lapsed at `now`.
 *
 * Inclusive end-of-day UTC, mirroring `isSuppressionExpired`: an entry that
 * expires on D is valid throughout D and fails from D+1 00:00:00.000Z. Getting
 * this boundary wrong by a day would reject a date the linter accepts, which
 * is a worse failure than accepting one it rejects — the user would be blocked
 * by a rule the tool does not actually have.
 */
export function isExpiryInPast(value: string, now: Date): boolean {
  const parsed = parseExpiryDate(value);
  if (parsed === null) return false;
  const end = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    23,
    59,
    59,
    999,
  );
  return now.getTime() > end;
}

// ─── building rows ────────────────────────────────────────────────────────────

/**
 * Builds the decision rows from a scan source.
 *
 * Guarantees:
 *  - rows come from `fresh` and nowhere else — the other three buckets are not
 *    decisions this screen makes;
 *  - one row per finding key, in the linter's own emission order (reordering
 *    would break the reader's mapping back onto their own repo); a repeated
 *    key is dropped rather than producing two rows fighting over one identity;
 *  - `baselined` defaults to FALSE. Accepting debt is never a default;
 *  - a finding whose previous suppression expired is flagged (`lapsedOn`) and
 *    its old `reason` is prefilled, because it was ratified once already and
 *    retyping it adds nothing. `expires` is deliberately NOT carried over: the
 *    date that just lapsed is the one value that must not be reused;
 *  - a non-collected source yields no rows at all. There is nothing to decide
 *    about a list that was never read.
 *
 * `ratifiedKeys` replays a decision the user already made, so Back from S6 is
 * non-destructive. A key with no matching row is ignored rather than
 * resurrected — the finding is gone, and inventing a row for it would put a
 * suppression in the draft for something the scan no longer sees.
 */
export function buildFindingsReviewRows(
  source: FindingsReviewSource,
  ratifiedKeys?: readonly string[] | null,
): readonly FindingsReviewRow[] {
  if (source.kind !== "collected") return [];

  const lapsed = new Map<string, ScanFinding>();
  for (const entry of source.expired) {
    lapsed.set(findingKey(entry), entry);
  }
  const alreadyRatified = new Set(ratifiedKeys ?? []);

  const rows: FindingsReviewRow[] = [];
  const seen = new Set<string>();

  for (const finding of source.fresh) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);

    const previous = lapsed.get(key);
    rows.push({
      key,
      rule: finding.rule,
      file: finding.file,
      specifier: finding.specifier,
      message: finding.message,
      baselined: alreadyRatified.has(key),
      reason: previous?.reason ?? "",
      expires: "",
      lapsedOn: previous?.expires ?? null,
    });
  }

  return rows;
}

/**
 * Groups rows by rule, DYNAMICALLY.
 *
 * `rule` is an open `string` on the linter's contract, so there is no key set
 * to switch on and a hardcoded one would silently drop the next rule anyone
 * adds. Group order is by size descending, then rule name ascending — a total
 * order, so the same findings always render the same way, and the largest
 * block of debt is the first thing the reader meets. Row order INSIDE a group
 * is untouched.
 */
export function groupRowsByRule(
  rows: readonly FindingsReviewRow[],
): readonly FindingsReviewRuleGroup[] {
  const byRule = new Map<string, FindingsReviewRow[]>();
  for (const row of rows) {
    const bucket = byRule.get(row.rule);
    if (bucket) bucket.push(row);
    else byRule.set(row.rule, [row]);
  }

  return [...byRule.entries()]
    .map(([rule, groupRows]) => ({
      rule,
      rows: groupRows as readonly FindingsReviewRow[],
      baselinedCount: groupRows.filter((row) => row.baselined).length,
    }))
    .sort((a, b) =>
      b.rows.length !== a.rows.length
        ? b.rows.length - a.rows.length
        : a.rule < b.rule
          ? -1
          : a.rule > b.rule
            ? 1
            : 0,
    );
}

// ─── editing rows ─────────────────────────────────────────────────────────────

/**
 * Replaces matching rows, preserving object identity everywhere it can.
 *
 * A no-op returns the SAME array reference and an untouched row keeps its own
 * reference — not micro-optimisation: the view feeds these straight into
 * `EntityDataGrid`, and identity is what lets a host memoise without diffing.
 */
function replaceRows(
  rows: readonly FindingsReviewRow[],
  matches: (row: FindingsReviewRow) => boolean,
  update: (row: FindingsReviewRow) => FindingsReviewRow,
): readonly FindingsReviewRow[] {
  let changed = false;
  const next = rows.map((row) => {
    if (!matches(row)) return row;
    const updated = update(row);
    if (updated !== row) changed = true;
    return updated;
  });
  return changed ? next : rows;
}

/** Accepts or re-enforces one finding. Both directions cost exactly one call. */
export function setFindingBaselined(
  rows: readonly FindingsReviewRow[],
  key: string,
  baselined: boolean,
): readonly FindingsReviewRow[] {
  return replaceRows(
    rows,
    (row) => row.key === key,
    (row) => (row.baselined === baselined ? row : { ...row, baselined }),
  );
}

/** Stores the justification as typed. Trimming happens at projection time. */
export function setFindingReason(
  rows: readonly FindingsReviewRow[],
  key: string,
  reason: string,
): readonly FindingsReviewRow[] {
  return replaceRows(
    rows,
    (row) => row.key === key,
    (row) => (row.reason === reason ? row : { ...row, reason }),
  );
}

/** Stores the expiry as typed, valid or not — the validator reports on it. */
export function setFindingExpires(
  rows: readonly FindingsReviewRow[],
  key: string,
  expires: string,
): readonly FindingsReviewRow[] {
  return replaceRows(
    rows,
    (row) => row.key === key,
    (row) => (row.expires === expires ? row : { ...row, expires }),
  );
}

/**
 * The ONLY bulk baseline operation, and it is scoped to one rule and requires
 * a stated reason.
 *
 * ## Why there is no repo-wide "baseline everything"
 *
 * A "select all" on this screen is one click that accepts the entire
 * architectural debt of somebody else's codebase, on a screen the user reached
 * ninety seconds after uploading a zip. That is the single most consequential
 * action in the flow and the cheapest one to perform by reflex, which is the
 * wrong ratio in the wrong direction.
 *
 * It is also unusable even if it were wise: every entry needs a non-empty
 * `reason` or `parseBaseline` throws, so a global select-all would produce N
 * invalid rows and a wall of errors that the user then has to fill in one at a
 * time — the convenience is imaginary.
 *
 * A RULE GROUP is a defensible unit of debt: "every one of these 18
 * cross-package imports predates adoption, tracked in ADR-0054" is a true and
 * checkable sentence, whereas "everything is fine" is not. So the bulk action
 * takes the sentence as an argument, and refuses without one:
 *
 *  - an empty (or whitespace) `reason` is a NO-OP. Bulk-accepting debt with no
 *    stated justification is not expressible through this module;
 *  - a row that already carries a reason keeps it. A group action must not
 *    clobber a justification someone wrote for a specific finding;
 *  - rows outside the named rule are untouched, including their identity.
 *
 * The opposite direction (`clearRuleGroupBaseline`, `clearAllBaselines`) has
 * no such guard, and that asymmetry is the point: un-accepting debt is always
 * safe, so it is always one click.
 */
export function baselineRuleGroup(
  rows: readonly FindingsReviewRow[],
  rule: string,
  reason: string,
): readonly FindingsReviewRow[] {
  const shared = reason.trim();
  if (shared === "") return rows;

  return replaceRows(
    rows,
    (row) => row.rule === rule,
    (row) => {
      const nextReason = row.reason.trim() === "" ? shared : row.reason;
      if (row.baselined && row.reason === nextReason) return row;
      return { ...row, baselined: true, reason: nextReason };
    },
  );
}

/**
 * Re-enforces every finding under one rule.
 *
 * The typed reason is deliberately KEPT: un-ticking is often a "wait, let me
 * re-read this" move, and destroying the justification would punish the user
 * for looking twice.
 */
export function clearRuleGroupBaseline(
  rows: readonly FindingsReviewRow[],
  rule: string,
): readonly FindingsReviewRow[] {
  return replaceRows(
    rows,
    (row) => row.rule === rule,
    (row) => (row.baselined ? { ...row, baselined: false } : row),
  );
}

/** Re-enforces everything. The safe direction, so it needs no justification. */
export function clearAllBaselines(
  rows: readonly FindingsReviewRow[],
): readonly FindingsReviewRow[] {
  return replaceRows(
    rows,
    () => true,
    (row) => (row.baselined ? { ...row, baselined: false } : row),
  );
}

// ─── validation ───────────────────────────────────────────────────────────────

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Everything the screen needs to know about whether this draft may be written.
 *
 * `reason` and `expires` are validated ONLY on rows the user actually marked
 * to baseline. Text left behind on an un-ticked row is dropped by
 * `toBaselineDraft` and never reaches the file, so blocking Continue on it
 * would be blocking on data that does not exist.
 *
 * `now` is a parameter, not a `new Date()` read inside the function: expiry is
 * the one rule here whose answer changes with the clock, and a transform that
 * silently consults the wall clock cannot be tested at a boundary.
 */
export function validateFindingsReview(
  rows: readonly FindingsReviewRow[],
  source: FindingsReviewSource,
  now: Date = new Date(),
): FindingsReviewValidation {
  const rowMessages: Record<string, FindingsRowMessage> = {};
  let baselinedCount = 0;
  let expiringCount = 0;
  let errorCount = 0;

  for (const row of rows) {
    if (!row.baselined) continue;
    baselinedCount += 1;

    if (row.reason.trim() === "") {
      rowMessages[row.key] = {
        severity: "error",
        text: "Say why this is accepted debt. The baseline file is rejected outright if an entry has no reason.",
      };
      errorCount += 1;
      continue;
    }

    if (row.expires === "") continue;

    if (!isValidExpiryDate(row.expires)) {
      rowMessages[row.key] = {
        severity: "error",
        text: "Expiry must be a real calendar date written as YYYY-MM-DD. Leave it empty for a suppression with no end date.",
      };
      errorCount += 1;
      continue;
    }

    if (isExpiryInPast(row.expires, now)) {
      rowMessages[row.key] = {
        severity: "error",
        text: "That date has already passed, so this entry would fail the gate the moment it is written. Pick a future date or leave it empty.",
      };
      errorCount += 1;
      continue;
    }

    expiringCount += 1;
    rowMessages[row.key] = {
      severity: "warning",
      text: `This suppression lapses on ${row.expires}. An expired entry fails the gate even if the finding is gone by then — renew it or delete it before that date.`,
    };
  }

  const totalCount = rows.length;
  const enforcedCount = totalCount - baselinedCount;

  return {
    totalCount,
    baselinedCount,
    enforcedCount,
    expiringCount,
    errorCount,
    rowMessages,
    blockingReason: deriveBlockingReason(source, errorCount),
  };
}

/**
 * The two things that stop a baseline being written, in priority order.
 *
 * The source check comes FIRST and is unconditional. A scan whose findings
 * could not be read has no rows, so every count is zero and every other check
 * passes — which is precisely the false green the `ScanFindings` contract
 * exists to prevent. Ratifying there would write an empty baseline that
 * asserts the tree is clean on the strength of a scan that never reported.
 */
function deriveBlockingReason(
  source: FindingsReviewSource,
  errorCount: number,
): string | null {
  if (source.kind === "not-collected") {
    return `The scan could not read its findings (${source.failureReason}), so there is nothing to ratify. An unread list is not an empty one — go back and run the scan again.`;
  }
  if (source.kind === "not-reported") {
    return "This scan reported no findings list at all, so there is nothing to ratify. That is not the same as a clean tree — go back and run the scan again with a current hexagen CLI.";
  }
  if (errorCount > 0) {
    return `${errorCount} ${pluralize(errorCount, "finding is", "findings are")} marked to baseline but cannot be written yet. Fix the highlighted ${pluralize(errorCount, "row", "rows")} first.`;
  }
  return null;
}

/** True when `toBaselineDraft` may legally be handed to the flow. */
export function canRatifyFindings(
  rows: readonly FindingsReviewRow[],
  source: FindingsReviewSource,
  now: Date = new Date(),
): boolean {
  return validateFindingsReview(rows, source, now).blockingReason === null;
}

/**
 * The consequence sentence, in one place.
 *
 * The screen's whole job is to make "this stops failing CI" legible, so the
 * sentence that says it is derived here and asserted in a test rather than
 * being assembled inline in JSX where nothing checks it.
 */
export function describeBaselineConsequence(
  validation: FindingsReviewValidation,
): string {
  if (validation.totalCount === 0) {
    return "No fresh findings to review. Nothing will be added to the baseline.";
  }
  if (validation.baselinedCount === 0) {
    return `Nothing is baselined. All ${validation.totalCount} ${pluralize(validation.totalCount, "finding", "findings")} will keep failing the gate until they are fixed.`;
  }
  const accepted = `${validation.baselinedCount} ${pluralize(validation.baselinedCount, "finding", "findings")} will be recorded as accepted debt and will stop failing the gate.`;
  const remaining =
    validation.enforcedCount === 0
      ? "Nothing is left enforced, so the gate will pass on today's findings."
      : `${validation.enforcedCount} ${pluralize(validation.enforcedCount, "finding", "findings")} will keep failing it until fixed.`;
  return `${accepted} ${remaining}`;
}

// ─── advisories and counts ────────────────────────────────────────────────────

/**
 * Bucket counts for the summary pills.
 *
 * A non-collected source yields no counts at all rather than four zeroes —
 * the caller must render the failure, and handing it a tidy row of zeroes is
 * how "we could not look" gets painted as "we looked and it was fine".
 */
export function summarizeFindingsSource(
  source: FindingsReviewSource,
): FindingsSourceCounts | null {
  if (source.kind !== "collected") return null;
  return {
    fresh: source.fresh.length,
    baselined: source.baselined.length,
    stale: source.stale.length,
    expired: source.expired.length,
  };
}

/**
 * Baseline entries the user cannot act on from this screen, worst first.
 *
 * `expired` leads because it is the only bucket that fails the gate for a
 * reason the user would never guess: the entry fails WHETHER OR NOT the
 * finding still reproduces, so "I fixed it" does not clear it.
 *
 * The `baselined` bucket is deliberately absent. Those are findings whose debt
 * was accepted on a previous run and which are behaving exactly as intended —
 * they are a number in the summary, not an action item, and listing them next
 * to two lists of problems would imply otherwise.
 */
export function buildFindingsAdvisories(
  source: FindingsReviewSource,
): readonly FindingsAdvisory[] {
  if (source.kind !== "collected") return [];

  const advisories: FindingsAdvisory[] = [];
  const seen = new Set<string>();

  const push = (entry: ScanFinding, kind: FindingsAdvisoryKind) => {
    const key = `${kind}${KEY_SEPARATOR}${findingKey(entry)}`;
    if (seen.has(key)) return;
    seen.add(key);
    advisories.push({
      key,
      kind,
      rule: entry.rule,
      file: entry.file,
      specifier: entry.specifier,
      reason: entry.reason ?? "",
      expires: entry.expires ?? "",
      consequence:
        kind === "expired"
          ? "The suppression has lapsed. It fails the gate even though the finding may already be fixed — renew it or delete it."
          : "The finding is gone but the baseline entry is still there. Delete the entry; a stale entry fails the ratchet.",
    });
  };

  for (const entry of source.expired) push(entry, "expired");
  for (const entry of source.stale) push(entry, "stale");
  return advisories;
}

/**
 * Finished copy for the two arms where there is no list to review.
 *
 * Returned as `{ title, description }` because `EmptyState` has no `error`
 * prop by design: the boundary decides what a failure MEANS and hands the
 * primitive finished sentences. Deciding it here, in the pure module, is what
 * lets the wording be asserted without rendering anything.
 */
export function describeUnavailableFindings(
  source: FindingsReviewSource,
): { readonly title: string; readonly description: string } | null {
  if (source.kind === "not-collected") {
    return {
      title: "The scan could not read the findings",
      description: `The scan reported: ${source.failureReason}. Nothing was checked, so this is not a clean tree — there is no list to review and no baseline to write.`,
    };
  }
  if (source.kind === "not-reported") {
    return {
      title: "This scan reported no findings list",
      description:
        "The scan finished but sent back no findings at all, which usually means the hexagen CLI that ran it predates the findings envelope. An absent list is not an empty one, so there is nothing to review here yet.",
    };
  }
  return null;
}

// ─── projection ───────────────────────────────────────────────────────────────

/**
 * The keys the flow's `ratifyFindings` takes.
 *
 * Row order, not sorted: this is the record of what the user chose, and the
 * order they chose it in is the order they saw.
 */
export function toBaselinedFindingKeys(
  rows: readonly FindingsReviewRow[],
): string[] {
  return rows.filter((row) => row.baselined).map((row) => row.key);
}

/**
 * Projects the decisions down to a baseline file payload.
 *
 * Mirrors `serializeBaseline` / `persistableEntry` deliberately:
 *  - only `rule`, `file`, `specifier`, `reason`, `expires` are emitted.
 *    `parseBaselineEntry` rejects any other key outright, so carrying one
 *    extra field would produce a file the linter refuses to read;
 *  - `expires` is OMITTED when empty rather than written as `""` — same rule
 *    as `persistableEntry`, and `parseBaselineEntry` would reject a non-string
 *    or unparseable value;
 *  - entries are sorted by finding key, so two runs over the same decisions
 *    produce the same bytes and a real diff stays readable.
 *
 * Rows that could not legally be written are DROPPED, not repaired: a
 * baselined row with no reason, or with an expiry that is not a real calendar
 * date. `canRatifyFindings` blocks the screen before this is ever reached with
 * such a row, so dropping is a belt-and-braces guarantee that this function is
 * total and never emits a file `parseBaseline` throws on. It deliberately does
 * NOT silently drop a PAST expiry — that value is well-formed and the user
 * typed it on purpose; blocking is the honest response and the validator does
 * exactly that.
 */
export function toBaselineDraft(
  rows: readonly FindingsReviewRow[],
): BrownfieldBaselineDraft {
  const entries: BrownfieldBaselineEntryDraft[] = [];

  for (const row of rows) {
    if (!row.baselined) continue;
    const reason = row.reason.trim();
    if (reason === "") continue;
    const expires = row.expires.trim();
    if (expires !== "" && !isValidExpiryDate(expires)) continue;

    entries.push(
      expires === ""
        ? { rule: row.rule, file: row.file, specifier: row.specifier, reason }
        : {
            rule: row.rule,
            file: row.file,
            specifier: row.specifier,
            reason,
            expires,
          },
    );
  }

  entries.sort((a, b) => {
    const left = findingKey(a);
    const right = findingKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return { version: BROWNFIELD_BASELINE_VERSION, entries };
}
