import type { ReportBaselineEntry } from "./types.js";

const EXPIRES_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ReportBaselineFile {
  version: number;
  entries: ReportBaselineEntry[];
}

/**
 * Local reader aligned with `@hexagen/arch-linter` parseBaseline (version 1,
 * rule/file/specifier required, optional reason/expires). Kept here so the
 * sync CLI does not take a runtime dependency on the linter package.
 */
export function parseReportBaseline(text: string): ReportBaselineFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`baseline is not valid JSON (${(e as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("baseline: expected a JSON object at the top level");
  }
  const obj = raw as { version?: unknown; entries?: unknown };
  if (typeof obj.version !== "number") {
    throw new Error("baseline: missing numeric 'version'");
  }
  if (obj.version !== 1) {
    throw new Error(`baseline: unsupported version ${obj.version}`);
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error("baseline: missing 'entries' array");
  }
  const entries: ReportBaselineEntry[] = obj.entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`baseline entry ${index} is not an object`);
    }
    const candidate = entry as Record<string, unknown>;
    const allowedKeys = new Set([
      "rule",
      "file",
      "specifier",
      "reason",
      "expires",
      "note",
    ]);
    for (const k of Object.keys(candidate)) {
      if (!allowedKeys.has(k))
        throw new Error(`baseline entry ${index} has unrecognized key '${k}'`);
    }

    for (const field of ["rule", "file"] as const) {
      if (
        typeof candidate[field] !== "string" ||
        !(candidate[field] as string).trim()
      ) {
        throw new Error(
          `baseline entry ${index} has no valid string '${field}'`,
        );
      }
    }
    if (typeof candidate.specifier !== "string") {
      throw new Error(`baseline entry ${index} has no string 'specifier'`);
    }
    const parsed: ReportBaselineEntry = {
      rule: (candidate.rule as string).trim(),
      file: (candidate.file as string).trim(),
      specifier: candidate.specifier,
    };

    if ("reason" in candidate) {
      if (typeof candidate.reason !== "string" || !candidate.reason.trim()) {
        throw new Error(
          `baseline entry ${index} has empty or non-string 'reason'`,
        );
      }
      parsed.reason = candidate.reason.trim();
    } else if ("note" in candidate) {
      if (typeof candidate.note !== "string" || !candidate.note.trim()) {
        throw new Error(
          `baseline entry ${index} has empty or non-string 'note'`,
        );
      }
      parsed.reason = candidate.note.trim();
    }

    if ("expires" in candidate) {
      if (typeof candidate.expires !== "string") {
        throw new Error(`baseline entry ${index} 'expires' is not a string`);
      }
      const match = EXPIRES_RE.exec(candidate.expires);
      if (!match) {
        throw new Error(
          `baseline entry ${index} has invalid 'expires' (want YYYY-MM-DD)`,
        );
      }
      const year = parseInt(match[1]!, 10);
      const month = parseInt(match[2]!, 10);
      const day = parseInt(match[3]!, 10);
      const utc = new Date(Date.UTC(year, month - 1, day));
      if (
        utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day
      ) {
        throw new Error(
          `baseline entry ${index} has invalid calendar date '${candidate.expires}'`,
        );
      }
      parsed.expires = candidate.expires;
    }
    return parsed;
  });
  return { version: obj.version, entries };
}
