/**
 * Delimiter-based turn splitting for pasted planning transcripts.
 *
 * A transcript exported from a multi-agent session is often already threaded
 * with `## Author` markdown headings (e.g. `## Grok`, `## Claude`, `## You`).
 * When at least two such headings are present, the paste can be split into one
 * turn per section instead of a single "Imported" blob. Detection is
 * deliberately conservative: fewer than two headings means the `##` lines are
 * probably ordinary document structure, not turn delimiters — no split.
 *
 * Pure and UI-free so it is unit-testable and reusable by future ingestion
 * paths (e.g. a Phase-3 session import).
 */

export interface SplitTurnDraft {
  /** Heading text, trimmed — becomes the turn's author label. */
  author: string;
  /** Section body, trimmed markdown. */
  content: string;
}

/** Matches a level-2 heading line whose text becomes the author label. */
const AUTHOR_HEADING = /^## (.+)$/;

/**
 * Split a pasted markdown transcript on `## Author` heading lines.
 *
 * Returns `null` when fewer than two heading lines match (no split — the
 * caller keeps its single-turn behavior). Otherwise:
 * - each `## Author` section becomes `{ author, content }` (both trimmed);
 * - a non-empty preamble before the first heading becomes an `"Imported"` turn;
 * - sections whose body trims to empty are skipped (a heading with no content
 *   is not a turn).
 *
 * Handles CRLF line endings (the `\r` is stripped before matching).
 */
export function splitTurnsByAuthorHeadings(
  markdown: string,
): SplitTurnDraft[] | null {
  const lines = markdown.split("\n").map((line) => line.replace(/\r$/, ""));

  const headingCount = lines.filter((line) => AUTHOR_HEADING.test(line)).length;
  if (headingCount < 2) return null;

  const turns: SplitTurnDraft[] = [];
  let author = "Imported"; // preamble before the first heading
  let body: string[] = [];

  const flush = () => {
    const content = body.join("\n").trim();
    if (content) turns.push({ author, content });
  };

  for (const line of lines) {
    const match = AUTHOR_HEADING.exec(line);
    if (match) {
      flush();
      // A heading of pure whitespace ("##   ") still delimits a section; label
      // it like the load-perimeter salvage labels a missing author.
      author = match[1].trim() || "Unknown";
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();

  return turns;
}
