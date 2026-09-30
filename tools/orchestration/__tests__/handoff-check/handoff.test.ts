import { describe, expect, test } from "vitest";
import {
  HandoffError,
  parseHandoff,
  testNames,
} from "../../src/handoff-check/lib/handoff.js";

const rule = {
  id: "conflict",
  statement: "disagreements win",
  test: "conflict when disagreements",
};
const good = { version: 1, lane: "W1", files: ["a.test.ts"], rules: [rule] };
const parse = (over: Record<string, unknown> = {}): unknown =>
  parseHandoff(JSON.stringify({ ...good, ...over }));
const withRule = (over: Record<string, unknown>): unknown =>
  parse({ rules: [{ ...rule, ...over }] });

describe("parseHandoff", () => {
  test("accepts a well-formed handoff", () => {
    expect(parse()).toEqual(good);
  });

  test("refuses text that is not JSON", () => {
    expect(() => parseHandoff("{oops")).toThrow(HandoffError);
  });

  test("refuses a document that is not an object", () => {
    expect(() => parseHandoff("[]")).toThrow(/must be an object/);
  });

  test("refuses an unknown version", () => {
    expect(() => parse({ version: 2 })).toThrow(/version must be 1/);
  });

  test("refuses a missing lane", () => {
    expect(() => parse({ lane: "  " })).toThrow(
      /lane must be a non-empty string/,
    );
  });

  test.each([
    "/etc/x.test.ts",
    "../../x.test.ts",
    "a/../../x.test.ts",
    "..",
    "C:\\x.test.ts",
  ])("refuses a declared file outside the repository: %s", (file) => {
    expect(() => parse({ files: [file] })).toThrow(/outside the repository/);
    expect(() => parse({ files: [file] })).toThrow(HandoffError);
  });

  test("accepts a relative path that stays inside, even after a .. segment", () => {
    expect(parse({ files: ["a/../b/c.test.ts", "./d.test.ts"] })).toBeDefined();
  });

  test("refuses an empty files list", () => {
    expect(() => parse({ files: [] })).toThrow(/non-empty array/);
    expect(() => parse({ files: [""] })).toThrow(/non-empty array/);
    expect(() => parse({ files: "a.ts" })).toThrow(/non-empty array/);
  });

  test("refuses a handoff that binds no rule, and says why", () => {
    expect(() => parse({ rules: [] })).toThrow(
      /the omission this check exists to catch/,
    );
    expect(() => parse({ rules: {} })).toThrow(
      /the omission this check exists to catch/,
    );
  });

  test("refuses a rule that is not an object", () => {
    expect(() => parse({ rules: ["x"] })).toThrow(
      /rules\[0\] must be an object/,
    );
  });

  test("refuses an empty id, statement or test name", () => {
    for (const field of ["id", "statement", "test"] as const) {
      expect(() => withRule({ [field]: "" })).toThrow(
        new RegExp(`${field} must be a non-empty`),
      );
      expect(() => withRule({ [field]: 3 })).toThrow(
        new RegExp(`${field} must be a non-empty`),
      );
    }
  });

  test("refuses two rules sharing an id", () => {
    expect(() => parse({ rules: [rule, rule] })).toThrow(
      /duplicate id "conflict"/,
    );
  });
});

describe("testNames", () => {
  test("reads test() and it() names in either quote style", () => {
    const src = `test("one", () => {}); it('two', () => {}); test(\`three\`, () => {});`;
    expect(testNames(src)).toEqual(["one", "two", "three"]);
  });

  test("keeps a name containing the other quote character", () => {
    expect(testNames(`test("a 'quoted' name", () => {})`)).toEqual([
      "a 'quoted' name",
    ]);
  });

  test("decodes an escaped quote of the same kind rather than truncating the name", () => {
    // Reading this as truncated made a bound rule look unbound, which blocks a
    // handoff that was complete — a false "not ready".
    const src = 'test("a \\"quoted\\" name", () => {})';
    expect(testNames(src)).toEqual(['a "quoted" name']);
  });

  test("does not run two adjacent tests together when the first name ends in a backslash escape", () => {
    const src = 'test("first \\\\", () => {}); test("second", () => {})';
    expect(testNames(src)).toEqual(["first \\", "second"]);
  });

  test("ignores describe blocks, which are not tests", () => {
    expect(
      testNames(`describe("group", () => { test("real", () => {}) })`),
    ).toEqual(["real"]);
  });

  test("is re-entrant across calls", () => {
    const src = `test("x", () => {})`;
    expect(testNames(src)).toEqual(["x"]);
    expect(testNames(src)).toEqual(["x"]);
  });

  test("returns nothing for a file with no tests", () => {
    expect(testNames("export const a = 1;")).toEqual([]);
  });
});
