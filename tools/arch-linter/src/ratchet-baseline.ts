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

export interface BaselineEntry {
  /** Stable rule id (e.g. `npm-package-in-domain`). */
  rule: string;
  /** Repo-relative, posix-separated path of the offending file. */
  file: string;
  /** Module specifier, or "" for findings that are not import-scoped. */
  specifier: string;
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
export function serializeBaseline(entries: BaselineEntry[]): string {
  const unique = new Map<string, BaselineEntry>();
  for (const entry of entries) {
    unique.set(violationKey(entry), {
      rule: entry.rule,
      file: entry.file,
      specifier: entry.specifier,
    });
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
  const entries: BaselineEntry[] = obj.entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`entry ${index} is not an object`);
    }
    const candidate = entry as Record<string, unknown>;
    for (const field of ["rule", "file", "specifier"] as const) {
      if (typeof candidate[field] !== "string") {
        throw new Error(`entry ${index} has no string '${field}'`);
      }
    }
    return {
      rule: candidate.rule as string,
      file: candidate.file as string,
      specifier: candidate.specifier as string,
    };
  });
  return { version: obj.version, entries };
}

export interface PartitionResult {
  /** Violations absent from the baseline — these fail the run. */
  fresh: ViolationRecord[];
  /** Violations present in the baseline — suppressed. */
  baselined: ViolationRecord[];
  /** Baseline entries with no matching violation — fixed, delete them. */
  stale: BaselineEntry[];
}

export function partitionAgainstBaseline(
  violations: ViolationRecord[],
  baseline: BaselineEntry[],
): PartitionResult {
  const baselineKeys = new Set(baseline.map(violationKey));
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

  const stale = baseline.filter((entry) => !seen.has(violationKey(entry)));
  return { fresh, baselined, stale };
}
