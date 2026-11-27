/**
 * The ratchet baseline (ADR-0054 §1).
 *
 * CI cannot go strict-from-zero: closing the AUD-011 layer-rule holes surfaces
 * exactly the violations Waves 5–8 are scheduled to burn down, and failing on
 * all of them would red-wall `main` for the duration. So the linter fails on
 * **new** violations only, measured against a committed baseline that is allowed
 * to shrink and never to grow.
 *
 * Contract:
 *  - a violation whose key is in the baseline is reported as suppressed and does
 *    NOT fail the run;
 *  - any violation whose key is absent fails the run — that is a regression;
 *  - a baseline entry that no longer reproduces is STALE: warned about, so the
 *    PR that fixed it can delete its own entry (the discipline is review-
 *    enforced, per ADR-0054 §1);
 *  - a baseline file that exists but cannot be parsed is FATAL at the call site.
 *    Falling back to "no baseline" would silently turn the ratchet into a hard
 *    gate; falling back to "empty" would silently disable it. Same fail-closed
 *    doctrine as the malformed-config handling in `cli.ts`.
 *
 * The key is `rule | file | specifier` — deliberately NOT the rendered message
 * and NOT a line number, so re-wording a diagnostic or moving code inside a file
 * does not invalidate the baseline.
 */

export const BASELINE_VERSION = 1;

/** Default location, relative to the project root. */
export const DEFAULT_BASELINE_RELATIVE_PATH =
  ".architecture/arch-lint-baseline.json";

/** Fields the baseline schema accepts. Anything else is a parse error. */
export const BASELINE_ENTRY_FIELDS = [
  "rule",
  "file",
  "specifier",
  "reason",
  "expires",
] as const;

/**
 * Pre-suppression field on `main` baselines. Parsed as `reason` when `reason`
 * is absent so `--ratchet --pr-diff` can read `origin/main` without a FATAL.
 * Never written back — `persistableEntry` emits `reason` only.
 */
export const LEGACY_NOTE_FIELD = "note";

/**
 * JSON-origin bounds (D1, lane H4). The baseline is data read from disk, so
 * like every JSON-origin artifact it needs an explicit SCHEMA with bounds —
 * not Proxy detection, which only applies at in-process boundaries. A baseline
 * with a million entries or an unbounded `reason` is either a mistake or
 * something hostile: either way, refuse instead of degrading.
 */
export const MAX_BASELINE_ENTRIES = 1000;
export const MAX_BASELINE_FIELD_LENGTH = 2048;

/**
 * Keys an object parsed from baseline JSON must never carry (top level or
 * per entry). Checked against `Object.getOwnPropertyNames`, because
 * `JSON.parse` plants `__proto__` as an ordinary own property (the prototype
 * setter is not invoked) — a `key in obj` or `Object.keys` miss is possible on
 * non-enumerable shapes, but own property names are exhaustive.
 */
export const RESERVED_BASELINE_KEYS: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
];

const RESERVED_KEYS_SET = new Set(RESERVED_BASELINE_KEYS);

function reservedKeysOf(object: object): string[] {
  return Object.getOwnPropertyNames(object).filter((key) =>
    RESERVED_KEYS_SET.has(key),
  );
}

export type BaselineEntryField = (typeof BASELINE_ENTRY_FIELDS)[number];

export interface BaselineEntry {
  /** Stable rule id (e.g. `npm-package-in-domain`). */
  rule: string;
  /** Repo-relative, posix-separated path of the offending file. */
  file: string;
  /** Module specifier, or "" for findings that are not import-scoped. */
  specifier: string;
  /**
   * Why this finding is accepted debt. Optional: existing entries may omit it.
   * When present it must be a non-empty string.
   */
  reason?: string;
  /**
   * Inclusive calendar date (`YYYY-MM-DD`, UTC) after which the suppression
   * no longer holds. An expired entry fails the gate even if the finding is
   * gone — delete or renew it. Omit for an open-ended suppression.
   */
  expires?: string;
}

/** A live finding. `message` is display-only and never part of the key. */
export interface ViolationRecord extends BaselineEntry {
  message: string;
}

export interface BaselineFile {
  version: number;
  entries: BaselineEntry[];
}

// NUL cannot occur in a rule id, a path, or a module specifier, so the key
// stays unambiguous whatever the fields contain. Internal only — never printed.
const SEPARATOR = "\u0000";

export function violationKey(entry: BaselineEntry): string {
  return `${entry.rule}${SEPARATOR}${entry.file}${SEPARATOR}${entry.specifier}`;
}

function compareEntries(a: BaselineEntry, b: BaselineEntry): number {
  return violationKey(a) < violationKey(b) ? -1 : 1;
}

/**
 * Deterministic, diff-friendly JSON: entries sorted by key, one entry per line.
 *
 * `JSON.stringify(_, null, 2)` would spread every entry across four lines, so a
 * single fixed violation would show up as a four-line diff hunk. One line per
 * entry makes the burn-down of a remediation PR literally readable as deleted
 * lines, which is what ADR-0054 asks of the artifact ("small and human-diffable").
 */
function persistableEntry(entry: BaselineEntry): BaselineEntry {
  const persisted: BaselineEntry = {
    rule: entry.rule,
    file: entry.file,
    specifier: entry.specifier,
  };
  if (typeof entry.reason === "string" && entry.reason.length > 0) {
    persisted.reason = entry.reason;
  }
  if (typeof entry.expires === "string" && entry.expires.length > 0) {
    persisted.expires = entry.expires;
  }
  return persisted;
}

export function serializeBaseline(entries: BaselineEntry[]): string {
  const unique = new Map<string, BaselineEntry>();
  for (const entry of entries) {
    unique.set(violationKey(entry), persistableEntry(entry));
  }
  const sorted = [...unique.values()].sort(compareEntries);
  const lines = sorted.map((entry) => `    ${JSON.stringify(entry)}`);
  return [
    "{",
    `  "version": ${BASELINE_VERSION},`,
    lines.length === 0 ? '  "entries": []' : '  "entries": [',
    ...(lines.length === 0 ? [] : [lines.join(",\n"), "  ]"]),
    "}",
    "",
  ].join("\n");
}

/**
 * Parse a baseline file. Throws with a reason on anything malformed — callers
 * must treat that as fatal rather than defaulting.
 */
export function parseBaseline(text: string): BaselineFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON (${(e as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("expected a JSON object at the top level");
  }
  const obj = raw as { version?: unknown; entries?: unknown };
  // Exact-key schema, before anything else touches the object: the top level
  // is `version` + `entries` and NOTHING else. A missing-key check alone would
  // let an extra key smuggle schema drift through silently.
  const topKeys = Object.getOwnPropertyNames(obj);
  const reservedTop = topKeys.filter((key) => RESERVED_KEYS_SET.has(key));
  if (reservedTop.length > 0) {
    throw new Error(
      `baseline has reserved key(s) ${reservedTop.map((k) => `'${k}'`).join(", ")} at the top level`,
    );
  }
  const extraTop = topKeys.filter(
    (key) => key !== "version" && key !== "entries",
  );
  if (extraTop.length > 0) {
    throw new Error(
      `unexpected top-level key(s) ${extraTop.map((k) => `'${k}'`).join(", ")} (allowed: 'version', 'entries')`,
    );
  }
  if (typeof obj.version !== "number") {
    throw new Error("missing numeric 'version'");
  }
  if (obj.version !== BASELINE_VERSION) {
    throw new Error(
      `unsupported baseline version ${obj.version} (this linter writes version ${BASELINE_VERSION})`,
    );
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error("missing 'entries' array");
  }
  if (obj.entries.length > MAX_BASELINE_ENTRIES) {
    throw new Error(
      `'entries' has ${obj.entries.length} items, exceeding the maximum of ${MAX_BASELINE_ENTRIES}`,
    );
  }
  const entries: BaselineEntry[] = obj.entries.map((entry, index) =>
    parseBaselineEntry(entry, index),
  );
  return { version: obj.version, entries };
}

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date `YYYY-MM-DD`. Rejects impossible months/days. */
export function parseExpiresDate(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = EXPIRES_RE.exec(value);
  if (!match) {
    throw new Error(
      `'expires' must be YYYY-MM-DD (got ${JSON.stringify(value)})`,
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
    throw new Error(`'expires' is not a real calendar date (${value})`);
  }
  return { year, month, day };
}

/**
 * Inclusive end-of-day UTC. An entry that expires on date D is still valid
 * throughout that UTC day and fails starting at D+1 00:00:00.000Z.
 */
export function isSuppressionExpired(
  expires: string,
  now: Date = new Date(),
): boolean {
  const { year, month, day } = parseExpiresDate(expires);
  const end = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return now.getTime() > end;
}

function parseBaselineEntry(entry: unknown, index: number): BaselineEntry {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error(`entry ${index} is not an object`);
  }
  const candidate = entry as Record<string, unknown>;
  const allowed = new Set<string>([
    ...BASELINE_ENTRY_FIELDS,
    LEGACY_NOTE_FIELD,
  ]);
  // Own property names, not `Object.keys`/`in`: JSON-parsed `__proto__` is an
  // ordinary own property, but the exact enumeration method matters for
  // non-JSON callers and the reserved check must hold for them too.
  const names = Object.getOwnPropertyNames(candidate);
  const reserved = names.filter((key) => RESERVED_KEYS_SET.has(key));
  if (reserved.length > 0) {
    throw new Error(
      `entry ${index} has reserved key(s) ${reserved.map((k) => `'${k}'`).join(", ")}`,
    );
  }
  const unknown = names.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `entry ${index} has unknown field(s) ${unknown.map((k) => `'${k}'`).join(", ")} (allowed: ${[...BASELINE_ENTRY_FIELDS, LEGACY_NOTE_FIELD].join(", ")})`,
    );
  }
  for (const field of ["rule", "file", "specifier"] as const) {
    if (typeof candidate[field] !== "string") {
      throw new Error(`entry ${index} has no string '${field}'`);
    }
    if (
      (candidate[field] as string).length > MAX_BASELINE_FIELD_LENGTH
    ) {
      throw new Error(
        `entry ${index} '${field}' exceeds the maximum length of ${MAX_BASELINE_FIELD_LENGTH}`,
      );
    }
  }
  const parsed: BaselineEntry = {
    rule: candidate.rule as string,
    file: candidate.file as string,
    specifier: candidate.specifier as string,
  };
  if ("reason" in candidate) {
    if (
      typeof candidate.reason !== "string" ||
      candidate.reason.trim() === ""
    ) {
      throw new Error(`entry ${index} has empty or non-string 'reason'`);
    }
    if (candidate.reason.length > MAX_BASELINE_FIELD_LENGTH) {
      throw new Error(
        `entry ${index} 'reason' exceeds the maximum length of ${MAX_BASELINE_FIELD_LENGTH}`,
      );
    }
    parsed.reason = candidate.reason;
  } else if ("note" in candidate) {
    if (typeof candidate.note !== "string" || candidate.note.trim() === "") {
      throw new Error(`entry ${index} has empty or non-string 'note'`);
    }
    if (candidate.note.length > MAX_BASELINE_FIELD_LENGTH) {
      throw new Error(
        `entry ${index} 'note' exceeds the maximum length of ${MAX_BASELINE_FIELD_LENGTH}`,
      );
    }
    parsed.reason = candidate.note;
  }
  if ("expires" in candidate) {
    if (typeof candidate.expires !== "string") {
      throw new Error(`entry ${index} has non-string 'expires'`);
    }
    if (candidate.expires.length > MAX_BASELINE_FIELD_LENGTH) {
      throw new Error(
        `entry ${index} 'expires' exceeds the maximum length of ${MAX_BASELINE_FIELD_LENGTH}`,
      );
    }
    parseExpiresDate(candidate.expires);
    parsed.expires = candidate.expires;
  }
  return parsed;
}

export interface PartitionResult {
  /** Violations absent from the (non-expired) baseline — these fail the run. */
  fresh: ViolationRecord[];
  /** Violations present in the baseline and not expired — suppressed. */
  baselined: ViolationRecord[];
  /** Baseline entries with no matching violation — fixed, delete them. */
  stale: BaselineEntry[];
  /**
   * Baseline entries whose `expires` date has passed. Always fail the gate,
   * whether or not the finding still reproduces.
   */
  expired: BaselineEntry[];
}

export function partitionAgainstBaseline(
  violations: ViolationRecord[],
  baseline: BaselineEntry[],
  now: Date = new Date(),
): PartitionResult {
  const expired = baseline.filter(
    (entry) =>
      typeof entry.expires === "string" &&
      isSuppressionExpired(entry.expires, now),
  );
  const expiredKeys = new Set(expired.map(violationKey));
  const active = baseline.filter(
    (entry) => !expiredKeys.has(violationKey(entry)),
  );
  const baselineKeys = new Set(active.map(violationKey));
  const seen = new Set<string>();

  const fresh: ViolationRecord[] = [];
  const baselined: ViolationRecord[] = [];

  for (const violation of violations) {
    const key = violationKey(violation);
    seen.add(key);
    if (baselineKeys.has(key)) {
      baselined.push(violation);
    } else {
      fresh.push(violation);
    }
  }

  const stale = active.filter((entry) => !seen.has(violationKey(entry)));
  return { fresh, baselined, stale, expired };
}

/**
 * When rewriting a baseline, keep `reason`/`expires` from the previous file
 * for any key that still reproduces. `--update-baseline` only sees live
 * findings, which do not carry suppression metadata.
 */
export function mergeSuppressionMetadata(
  next: BaselineEntry[],
  previous: BaselineEntry[],
): BaselineEntry[] {
  const prevByKey = new Map(
    previous.map((entry) => [violationKey(entry), entry]),
  );
  return next.map((entry) => {
    const prior = prevByKey.get(violationKey(entry));
    if (!prior) return persistableEntry(entry);
    return persistableEntry({
      ...entry,
      reason: entry.reason ?? prior.reason,
      expires: entry.expires ?? prior.expires,
    });
  });
}
