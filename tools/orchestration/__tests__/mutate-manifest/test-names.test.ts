import { describe, expect, test } from "vitest";
import { testNames } from "../../src/mutate-manifest/lib/test-names.js";

const names = (source: string, file = "s.test.ts"): readonly string[] =>
  testNames(source, file);

/**
 * The contract is SOUNDNESS, not completeness: every name returned is one the
 * file really registers, and a name that cannot be read off the syntax is
 * dropped rather than guessed at. The caller uses these to PROVE a `-t` pattern
 * live and escalates everything else to vitest, so a missed name costs a
 * listing and an invented one would cost a false proof.
 */
describe("testNames", () => {
  test("returns a bare test's title", () => {
    expect(names(`test("keeps a draft", () => {});`)).toEqual([
      "keeps a draft",
    ]);
  });

  test("joins the enclosing describe titles with a single space, as vitest does", () => {
    expect(
      names(`describe("outer", () => {
        describe("inner", () => {
          it("holds", () => {});
        });
      });`),
    ).toEqual(["outer inner holds"]);
  });

  test("reads `suite` as a scope too, not only `describe`", () => {
    expect(names(`suite("group", () => { test("one", () => {}); });`)).toEqual([
      "group one",
    ]);
  });

  test("reads a no-substitution template literal as a title", () => {
    expect(names("test(`a plain title`, () => {});")).toEqual([
      "a plain title",
    ]);
  });

  test("keeps a literal title behind a modifier call — `skipIf` does not change the name", () => {
    expect(
      names(
        `test.skipIf(!ok)("the encode spawns the resolved binary", () => {});`,
      ),
    ).toEqual(["the encode spawns the resolved binary"]);
  });

  test("drops an `each` title: vitest formats it per case, so the literal is not a name", () => {
    expect(
      names(`test.each(rows)("%s alone creates no undo step", () => {});`),
    ).toEqual([]);
  });

  test("drops a tagged-template `each` table for the same reason", () => {
    expect(names("test.each`a | b`(`$a and $b`, () => {});")).toEqual([]);
  });

  test("drops a title that is an expression rather than a literal", () => {
    expect(names(`test(skipReason ?? "the fallback", () => {});`)).toEqual([]);
  });

  test("drops a template literal with a substitution", () => {
    expect(names("test(`case ${n}`, () => {});")).toEqual([]);
  });

  test("drops a namer called with no arguments at all", () => {
    expect(names(`test();`)).toEqual([]);
  });

  test("takes a whole subtree with an unreadable describe title — a placeholder could be matched through", () => {
    expect(
      names(`describe(titles[0], () => {
        test("would be unknowable", () => {});
        describe("nested", () => { test("also unknowable", () => {}); });
      });`),
    ).toEqual([]);
  });

  test("keeps reading after an unreadable scope, rather than giving up on the file", () => {
    expect(
      names(`describe(titles[0], () => { test("lost", () => {}); });
        describe("kept", () => { test("found", () => {}); });`),
    ).toEqual(["kept found"]);
  });

  test("ignores calls that are not registrations", () => {
    expect(
      names(`expect(value).toBe(1); helper.test("not a test", () => {});`),
    ).toEqual([]);
  });

  test("ignores a call whose callee is not an identifier at all", () => {
    expect(names(`(runner)("not a test either", () => {});`)).toEqual([]);
  });

  test("parses TSX, where a bare type assertion would otherwise be a tag", () => {
    expect(
      names(
        `test("renders the rail", () => { render(<Rail a={1} />); });`,
        "s.test.tsx",
      ),
    ).toEqual(["renders the rail"]);
  });
});
