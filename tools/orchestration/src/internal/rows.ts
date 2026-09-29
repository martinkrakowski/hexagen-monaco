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

/**
 * The sha256 hex of one plan-table row, normalised: trimmed, with every run of
 * whitespace collapsed to one space, so a whitespace-only reflow of a row keeps
 * its hash and a one-word change breaks it. The id names the row by its first
 * cell — a lane id (`| **PT-5a** | …`) or a decision id (`| **D177** | …`) —
 * and the row must be unambiguous: zero matches or more than one is an error
 * naming the id and the count, never a hash of the wrong line.
 */
export function rowHash(markdown: string, id: string): string {
  const prefix = rowPrefix(id);
  const matches = markdown.split("\n").filter((line) => prefix.test(line));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one plan row for ${id}, found ${matches.length}`,
    );
  }
  const normalised = matches[0].trim().replace(/\s+/g, " ");
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
export function rowRisk(markdown: string, id: string): Risk {
  const pattern = rowSecondCellPattern(id);
  const matches: RegExpExecArray[] = [];
  for (const line of markdown.split("\n")) {
    const match = pattern.exec(line);
    if (match !== null) matches.push(match);
  }
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one plan row for ${id}, found ${matches.length}`,
    );
  }
  // Non-null: the capture group above is unconditional, so a match here
  // always carries one — see rowSecondCellPattern's own comment.
  const secondCell = matches[0][1]!.trim();
  if (secondCell === "**high**") return "high";
  if (secondCell === "normal") return "normal";
  if (RISK_WORD_AT_START.test(secondCell)) {
    return "normal";
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
