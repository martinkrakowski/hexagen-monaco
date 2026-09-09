import type { Result } from "@hexagen/shared";

/**
 * Hand-rolled parser for finding front matter — deliberately no YAML
 * dependency. A general YAML parser would accept nested maps, anchors and
 * multi-line blocks that the validator would then have to detect and reject,
 * which puts the F-D4 guarantee ("the record cannot carry client content") in a
 * rejection list; a strict line-based parser over the nine flat scalar keys of
 * F-D4 makes the wrong shape unrepresentable instead.
 *
 * This module parses SHAPE ONLY: every front-matter line must be exactly
 * `key: value` on one line. Which keys are legal and which values each one may
 * carry is the validator's job (`validate-finding.ts`).
 */

export interface FindingParseError {
  /** 1-based line number the refusal points at. */
  line: number;
  message: string;
}

export interface ParsedFinding {
  /** Key → normalized scalar. A key present with no value is `null`. */
  frontMatter: ReadonlyMap<string, string | null>;
  /** Everything after the closing `---` fence, verbatim. */
  body: string;
}

const FRONT_MATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/;

export function parseFinding(
  text: string,
): Result<ParsedFinding, FindingParseError> {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return {
      success: false,
      error: {
        line: 1,
        message: "a finding file must start with a '---' front-matter fence",
      },
    };
  }

  const frontMatter = new Map<string, string | null>();
  let i = 1;
  for (; i < lines.length; i++) {
    // The first '---' line after the opening fence closes the front matter.
    if (lines[i] === "---") break;
    const parsed = parseLine(lines[i], i + 1);
    if (!parsed.success) return parsed;
    // A repeated key is refused, not folded: last-wins makes the file a human
    // reads and the record this parser produces disagree — a finding named
    // `0001-*.md` claiming `id: 0002` — so the schema's nine keys are also
    // unique. Strict YAML (which this parser exists to out-spec) rejects the
    // same input.
    if (frontMatter.has(parsed.value.key)) {
      return {
        success: false,
        error: {
          line: i + 1,
          message: `duplicate front-matter key '${parsed.value.key}' — each key may appear only once`,
        },
      };
    }
    frontMatter.set(parsed.value.key, parsed.value.value);
  }
  if (i === lines.length) {
    return {
      success: false,
      error: {
        line: lines.length,
        message: "unterminated front matter — missing closing '---' fence",
      },
    };
  }

  return {
    success: true,
    value: { frontMatter, body: lines.slice(i + 1).join("\n") },
  };
}

function parseLine(
  line: string,
  lineNo: number,
): Result<{ key: string; value: string | null }, FindingParseError> {
  const m = FRONT_MATTER_LINE.exec(line);
  if (!m) {
    return {
      success: false,
      error: {
        line: lineNo,
        message:
          `front-matter line must be exactly 'key: value' on one line ` +
          `(no leading whitespace, no nesting, no blank lines) — found: ${JSON.stringify(line)}`,
      },
    };
  }

  const key = m[1];
  const rawValue = m[2];

  // Strip a trailing YAML comment (`key: value  # explanation`), the shape the
  // plan's own canonical example uses. A '#' that is part of the value token
  // (not preceded by whitespace) is left alone and fails the vocabulary check.
  const hash = rawValue.indexOf("#");
  const valueOnly =
    hash >= 0 && (hash === 0 || /\s$/.test(rawValue.slice(0, hash)))
      ? rawValue.slice(0, hash)
      : rawValue;

  const normalized = normalizeScalar(valueOnly.trim(), lineNo);
  if (!normalized.success) return normalized;
  return { success: true, value: { key, value: normalized.value } };
}

/**
 * YAML scalar normalization for the closed set of flat values: double-quoted,
 * single-quoted, or a bare token. `null`/`~`/empty map to null (YAML's empty
 * scalar); everything else is a string. Quoting must balance — an unterminated
 * quote is refused here rather than handed to a downstream check.
 */
function normalizeScalar(
  value: string,
  lineNo: number,
): Result<string | null, FindingParseError> {
  if (value === "null" || value === "~" || value === "") {
    return { success: true, value: null };
  }
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (
      value.length < 2 ||
      !value.endsWith(quote) ||
      value.slice(1, -1).includes(quote)
    ) {
      return {
        success: false,
        error: {
          line: lineNo,
          message: `unbalanced ${quote}quote in front-matter value: ${JSON.stringify(value)}`,
        },
      };
    }
    return { success: true, value: value.slice(1, -1) };
  }
  return { success: true, value };
}
