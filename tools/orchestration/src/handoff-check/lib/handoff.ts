import type { Handoff, RuleBinding } from "./types.js";

export class HandoffError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim() === "") {
    throw new HandoffError(`${field} must be a non-empty string`);
  }
  return v;
};

const strings = (v: unknown, field: string): readonly string[] => {
  if (
    !Array.isArray(v) ||
    v.length === 0 ||
    v.some((x) => typeof x !== "string" || x === "")
  ) {
    throw new HandoffError(
      `${field} must be a non-empty array of non-empty strings`,
    );
  }
  return v as readonly string[];
};

function parseRule(raw: unknown, index: number): RuleBinding {
  const at = `rules[${index}]`;
  if (!isRecord(raw)) throw new HandoffError(`${at} must be an object`);
  return {
    id: str(raw["id"], `${at}.id`),
    statement: str(raw["statement"], `${at}.statement`),
    test: str(raw["test"], `${at}.test`),
  };
}

export function parseHandoff(text: string): Handoff {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    // JSON.parse throws SyntaxError and nothing else; no non-Error arm to guard.
    throw new HandoffError(`not valid JSON: ${(error as SyntaxError).message}`);
  }
  if (!isRecord(raw)) throw new HandoffError("handoff must be an object");
  if (raw["version"] !== 1) throw new HandoffError("version must be 1");
  const rules = raw["rules"];
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new HandoffError(
      "rules must be a non-empty array — a handoff that binds no rule is the omission this check exists to catch",
    );
  }
  const parsed = rules.map(parseRule);
  const seen = new Set<string>();
  for (const rule of parsed) {
    if (seen.has(rule.id))
      throw new HandoffError(`rules: duplicate id "${rule.id}"`);
    seen.add(rule.id);
  }
  return {
    version: 1,
    lane: str(raw["lane"], "lane"),
    files: strings(raw["files"], "files"),
    rules: parsed,
  };
}

/**
 * Test names declared in a file, from `test("…")` / `it("…")` with either quote
 * style. Deliberately syntactic: a handoff names tests as written, and a name
 * built at runtime cannot be checked against a brief by a reader either.
 */
const NAME = /\b(?:test|it)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * Escapes are decoded so a handoff can name a test whose title contains the
 * quote character it is written with. `test("a \"quoted\" name")` is one test
 * name, not a truncated one — and reading it as truncated made the rule look
 * unbound, which blocks a handoff that was in fact complete.
 */
const unescape = (raw: string): string => raw.replace(/\\(.)/g, "$1");

export function testNames(source: string): readonly string[] {
  NAME.lastIndex = 0;
  return [...source.matchAll(NAME)].map((m) => unescape(m[2]));
}
