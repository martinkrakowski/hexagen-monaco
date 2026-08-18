import { parseReportBaseline } from "./baseline-read.js";
import type { GitReader, RatchetTrendPoint } from "./types.js";

export function collectRatchetTrend(
  git: GitReader,
  baselineRelPath: string,
  limit = 50,
): RatchetTrendPoint[] {
  const commits = git.logFollow(baselineRelPath).slice(0, limit);
  const points: RatchetTrendPoint[] = [];
  for (const commit of commits) {
    const text = git.show(commit.hash, baselineRelPath);
    if (text === null) continue;
    try {
      const parsed = parseReportBaseline(text);
      points.push({
        hash: commit.hash,
        isoDate: commit.isoDate,
        subject: commit.subject,
        entryCount: parsed.entries.length,
      });
    } catch {
      // A historical file that predates the schema is skipped, not fatal.
    }
  }
  return points;
}
