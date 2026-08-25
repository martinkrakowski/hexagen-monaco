import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { csrfTokensMatch, timingSafeEqualStrings } from "../csrf";

describe("D-H7 — timing-safe token comparison", () => {
  it("agrees with ordinary equality on equal, unequal, and length-mismatched inputs", () => {
    assert.equal(timingSafeEqualStrings("abc", "abc"), true);
    assert.equal(timingSafeEqualStrings("abc", "abd"), false);
    assert.equal(timingSafeEqualStrings("abc", "ab"), false);
    assert.equal(timingSafeEqualStrings("", ""), true);
    assert.equal(timingSafeEqualStrings("", "a"), false);
    // Differing only in the FIRST character — the case an early-exit compare
    // would answer fastest.
    assert.equal(
      timingSafeEqualStrings("x".padEnd(64, "a"), "y".padEnd(64, "a")),
      false,
    );
  });

  it("is constant-time BY CONSTRUCTION: XOR-accumulator, no early exit", () => {
    // Timing safety cannot be asserted with a stopwatch in CI — jitter
    // swamps it. Assert the construction instead: the comparison must
    // accumulate differences with XOR/OR over the full max(len) range and
    // contain no data-dependent return inside the loop. `===`/`!==` on the
    // inputs anywhere in the body would reintroduce an early exit.
    const source = timingSafeEqualStrings.toString();
    assert.match(source, /\^/, "must XOR character codes");
    assert.match(source, /\|=/, "must OR-accumulate differences");
    assert.match(
      source,
      /Math\.max/,
      "must iterate to the LONGER length so length leaks only via the result",
    );
    const body = source.slice(source.indexOf("{"));
    assert.equal(
      (body.match(/return/g) ?? []).length,
      1,
      "exactly one return — no early exit path",
    );
    // The single return reads the accumulator (`diff === 0`); with it removed,
    // no equality operator may touch the input strings anywhere in the body.
    const withoutFinalReturn = body.replace(/return[^;]*;/, "");
    assert.doesNotMatch(
      withoutFinalReturn,
      /===|!==|==|!=/,
      "no short-circuit equality on the inputs inside the comparison body",
    );
  });

  it("csrfTokensMatch refuses null/empty without ever calling it a match", () => {
    assert.equal(csrfTokensMatch(undefined, null), false);
    assert.equal(csrfTokensMatch("tok", null), false);
    assert.equal(csrfTokensMatch(undefined, "tok"), false);
    assert.equal(csrfTokensMatch("", ""), false);
    assert.equal(csrfTokensMatch("tok", "tok"), true);
  });
});
