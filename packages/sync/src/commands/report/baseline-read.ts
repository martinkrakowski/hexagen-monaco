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
    for (const field of ["rule", "file", "specifier"] as const) {
      if (typeof candidate[field] !== "string") {
        throw new Error(`baseline entry ${index} has no string '${field}'`);
      }
    }
    const parsed: ReportBaselineEntry = {
      rule: candidate.rule as string,
      file: candidate.file as string,
      specifier: candidate.specifier as string,
    };
    if (typeof candidate.reason === "string" && candidate.reason.trim()) {
      parsed.reason = candidate.reason;
    }
    if (typeof candidate.expires === "string") {
      if (!EXPIRES_RE.test(candidate.expires)) {
        throw new Error(
          `baseline entry ${index} has invalid 'expires' (want YYYY-MM-DD)`,
        );
      }
      parsed.expires = candidate.expires;
    }
    return parsed;
  });
  return { version: obj.version, entries };
}
