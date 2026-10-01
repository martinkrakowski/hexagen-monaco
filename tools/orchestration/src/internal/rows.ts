import { createHash } from "node:crypto";

/** The reserved lane token a plan review is emitted under — never a real lane's name. */
export const PLAN_REVIEW_LANE = "_plan";

/**
 * The leading cell of a plan's lane-table row, exactly as plans write it:
 * `| **<id>** | …`. The rest of the line is never parsed into cells, so a row
 * whose text carries a `|` inside backticks matches and hashes whole.
 */
function rowPrefix(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|`);
}

/** How many characters of a matching line an ambiguity error quotes. */
const QUOTED_LINE_START = 60;

/**
 * The error for an id that does not match exactly one row. A match count alone
 * sends the operator hunting, so each matching line is named by its 1-based
 * line number and the start of the line, and the plan file too when the caller
 * knows it. The count stays in the message: the refusal is the same, only
 * better explained.
 */
function ambiguousRowError(
  id: string,
  matches: readonly { readonly line: number; readonly text: string }[],
  plan: string | undefined,
): Error {
  const where =
    matches.length === 0
      ? ""
      : `: ${matches
          .map(({ line, text }) => {
            const start = text.trim();
            const quoted =
              start.length > QUOTED_LINE_START
                ? `${start.slice(0, QUOTED_LINE_START)}…`
                : start;
            return `line ${line}: ${quoted}`;
          })
          .join("; ")}`;
  return new Error(
    `${plan === undefined ? "" : `${plan}: `}expected exactly one plan row for ${id}, found ${matches.length}${where}`,
  );
}

/**
 * A plan-review marker line: `<!-- plan-review: lanes -->` before a lane table,
 * `<!-- plan-review: decisions -->` before a decision table. Both kinds scope
 * a row lookup the same way — every caller asks for a row by id alone, whether
 * the id names a lane or a decision, so one rule serves them all and no caller
 * has to say which kind it wants.
 */
const MARKER = /^[ \t]*<!--\s*plan-review:\s*(?:lanes|decisions)\s*-->[ \t]*$/;
/** A markdown heading, at any level: it ends the marker's region. */
const HEADING = /^[ \t]{0,3}#{1,6}(?:\s|$)/;
/** A code-fence line: a marker or heading inside a fence is example text. */
const FENCE = /^[ \t]{0,3}(?:```|~~~)/;

/**
 * Which lines of a plan may hold a row. A plan with no marker outside a code
 * fence keeps the original rule — every line counts, so a duplicate row is
 * still an error. A plan with at least one marker counts a line only inside a
 * marker's region: from the marker, across prose and further tables, to the
 * next heading. A bold-id row anywhere else in a marked plan — a "shipped"
 * table, say — is ignored, so it cannot collide with the real row.
 */
function eligibleLines(lines: readonly string[]): boolean[] {
  const eligible: boolean[] = [];
  let anyMarker = false;
  let inFence = false;
  let inRegion = false;
  for (const text of lines) {
    if (FENCE.test(text)) inFence = !inFence;
    if (!inFence) {
      if (MARKER.test(text)) {
        anyMarker = true;
        inRegion = true;
      } else if (HEADING.test(text)) {
        inRegion = false;
      }
    }
    eligible.push(inRegion);
  }
  return anyMarker ? eligible : lines.map(() => true);
}

/** Every eligible line of `markdown` the pattern matches, with its 1-based number. */
function matchingLines(
  markdown: string,
  pattern: RegExp,
): { line: number; text: string }[] {
  const lines = markdown.split("\n");
  const eligible = eligibleLines(lines);
  const found: { line: number; text: string }[] = [];
  lines.forEach((text, index) => {
    if (eligible[index] && pattern.test(text)) {
      found.push({ line: index + 1, text });
    }
  });
  return found;
}

/**
 * The sha256 hex of one plan-table row, normalised: trimmed, with every run of
 * whitespace collapsed to one space, so a whitespace-only reflow of a row keeps
 * its hash and a one-word change breaks it. The id names the row by its first
 * cell — a lane id (`| **PT-5a** | …`) or a decision id (`| **D177** | …`) —
 * and the row must be unambiguous: zero matches or more than one is an error
 * naming the id and the count, never a hash of the wrong line.
 */
export function rowHash(markdown: string, id: string, plan?: string): string {
  const matches = matchingLines(markdown, rowPrefix(id));
  if (matches.length !== 1) throw ambiguousRowError(id, matches, plan);
  const normalised = matches[0]!.text.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

/** A plan row's risk tier (D184): `high`, or `normal` for everything else. */
export type Risk = "high" | "normal";

/**
 * `rowPrefix`'s own prefix, continued by everything up to the next `|` (or
 * end of line, for a row with no further cells), captured as group 1 — the
 * row's second cell. The capture is unconditional (`[^|]*` matches even zero
 * characters), so a line this pattern's prefix matches always matches the
 * whole pattern too: there is no "matched the prefix, then failed to
 * re-match" state, which is why `rowRisk` never needs a second, separate
 * `exec` the way an `exec`-after-`test` pair would.
 */
function rowSecondCellPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*\\|\\s*\\*\\*${escaped}\\*\\*\\s*\\|([^|]*)`);
}

/**
 * A row's risk cell that reads like a risk word but is not one this package
 * accepts — `high`, `**high** (note)`, `**Normal**` — the failure A-1 exists
 * for.
 *
 * At the source, `rowRisk` returned `high` for a cell exactly `**high**` and
 * `normal` for EVERYTHING else, so a plan row that plainly said `high` read as
 * `normal`, D184's pre-PR gate never fired for it, and the gate failed OPEN.
 * These cells now fail loud instead.
 *
 * The message names the row, and the plan file when the caller knows it —
 * `discoverRisk` rethrows with the plan it was reading, so an operator can find
 * the file that has to be fixed.
 */
export class InvalidRiskCellError extends Error {
  /** The row id whose risk cell is malformed. */
  readonly id: string;
  /** The cell as written, trimmed. */
  readonly cell: string;
  /** The plan file, when the caller knows which one it was reading. */
  readonly plan: string | undefined;

  constructor(id: string, cell: string, plan?: string) {
    super(
      `${plan === undefined ? "" : `${plan}: `}row ${id} has an invalid risk cell ` +
        `${JSON.stringify(cell)} — expected exactly **high** or exactly normal`,
    );
    this.name = "InvalidRiskCellError";
    this.id = id;
    this.cell = cell;
    this.plan = plan;
  }
}

/**
 * A cell that STARTS with the word `high` or `normal` — after optional `*` bold
 * markers, case-insensitively, on a whole word. The exact-match cases below are
 * checked first, so this only ever sees the near misses: plain `high`, a
 * `**high**` carrying a trailing note, a differently-cased or differently-bolded
 * tier. `Delivers` prose, which is what the second cell holds in a table with no
 * Risk column at all, does not match it and stays `normal`.
 */
const RISK_WORD_AT_START = /^\**\s*(high|normal)\b/i;

/**
 * A row's risk tier, read from its SECOND cell.
 *
 * There is deliberately NO table-header detection. The source read the risk tier
 * from a column whose position it assumed, and this port keeps that reading
 * rather than trying to locate a "Risk" header: a plan may split one table into
 * sections with a prose line between them, so the OW4–OW6 rows sit under no
 * header at all, and a header-based rule would read them as `normal` — the
 * original bug, reached by a different route.
 *
 * The cell decides, and only the cell:
 *
 * | the second cell                        | result                          |
 * | ------------------------------------- | ------------------------------- |
 * | is exactly `**high**`                 | `high`                          |
 * | is exactly `normal`                   | `normal`                        |
 * | starts with `high`/`normal` otherwise  | throws `InvalidRiskCellError`   |
 * | anything else                          | `normal`                        |
 *
 * The last row is documented behaviour, not the bug: a table with no Risk
 * column holds the "Delivers" prose in that cell, and that has always read
 * `normal`. Only the third row changed, and it changed from silently `normal`
 * to loud.
 */
export function rowRisk(markdown: string, id: string, plan?: string): Risk {
  const pattern = rowSecondCellPattern(id);
  const lines = matchingLines(markdown, pattern);
  if (lines.length !== 1) throw ambiguousRowError(id, lines, plan);
  const matches = [pattern.exec(lines[0]!.text)!];
  // Non-null: the capture group above is unconditional, so a match here
  // always carries one — see rowSecondCellPattern's own comment.
  const secondCell = matches[0][1]!.trim();
  if (secondCell === "**high**") return "high";
  if (secondCell === "normal") return "normal";
  if (RISK_WORD_AT_START.test(secondCell)) {
    throw new InvalidRiskCellError(id, secondCell);
  }
  return "normal";
}

/** The hash map a plan-review event's detail carries, or `undefined` for anything else. */
export function asHashRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    record[key] = item;
  }
  return record;
}
