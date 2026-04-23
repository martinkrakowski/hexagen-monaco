import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { interpolate } from "../src/template-engine.js";

// Unit tests for template-engine.ts — the `interpolate()` helper used by
// SyncEngine generators to substitute `{variable}` placeholders in template
// strings.
//
// Contract under test (see TSDoc on `interpolate` in src/template-engine.ts):
//
//   - Recognised token shapes:
//       `{{`                       → literal `{`
//       `}}`                       → literal `}`
//       `{<identifier>}`           → substituted from `vars`
//     where identifier matches [A-Za-z_][A-Za-z0-9_.-]*
//
//   - Missing / null / undefined → placeholder left verbatim + warning pushed
//     (one entry per occurrence).
//
//   - Present values are stringified via `String(value)`; empty string, zero,
//     and `false` are all valid substitutions (distinct from "missing").
//
//   - The engine makes a single pass: substituted values containing `{x}` are
//     NOT re-interpolated.
//
//   - Shapes that do not match the token regex (e.g. `{ name }`, `{}`, `{1x}`,
//     a dangling `{`) are left untouched AND produce no warning.

describe("interpolate()", () => {
  // ---------------------------------------------------------------------------
  // Trivial templates
  // ---------------------------------------------------------------------------

  it("returns empty output and no warnings for an empty template", () => {
    const { output, warnings } = interpolate("", {});
    assert.equal(output, "");
    assert.deepEqual(warnings, []);
  });

  it("returns the template unchanged when it contains no placeholders", () => {
    const template = "plain text with no braces at all";
    const { output, warnings } = interpolate(template, { unused: "x" });
    assert.equal(output, template);
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Basic substitution
  // ---------------------------------------------------------------------------

  it("substitutes a single placeholder", () => {
    const { output, warnings } = interpolate("Hello {name}!", {
      name: "World",
    });
    assert.equal(output, "Hello World!");
    assert.deepEqual(warnings, []);
  });

  it("substitutes multiple distinct placeholders", () => {
    const { output, warnings } = interpolate(
      "{greeting}, {name}! Welcome to {place}.",
      { greeting: "Hello", name: "Ada", place: "Hexagen" },
    );
    assert.equal(output, "Hello, Ada! Welcome to Hexagen.");
    assert.deepEqual(warnings, []);
  });

  it("substitutes the same variable referenced multiple times", () => {
    const { output, warnings } = interpolate("{x}-{x}-{x}", { x: "a" });
    assert.equal(output, "a-a-a");
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Missing variables
  // ---------------------------------------------------------------------------

  it("keeps a placeholder verbatim and records a warning when the variable is missing", () => {
    const { output, warnings } = interpolate("Hello {name}!", {});
    assert.equal(output, "Hello {name}!");
    assert.deepEqual(warnings, ["name"]);
  });

  it("records a warning for each missing identifier in a template", () => {
    const { output, warnings } = interpolate("{a} and {b} and {c}", {
      b: "B",
    });
    assert.equal(output, "{a} and B and {c}");
    // Order of appearance, not alphabetical.
    assert.deepEqual(warnings, ["a", "c"]);
  });

  it("records duplicate identifiers once per occurrence (per-occurrence, per TSDoc)", () => {
    const { output, warnings } = interpolate(
      "{missing} {missing} {missing}",
      {},
    );
    assert.equal(output, "{missing} {missing} {missing}");
    assert.deepEqual(warnings, ["missing", "missing", "missing"]);
  });

  it("treats a null value as missing (warning, placeholder kept)", () => {
    const { output, warnings } = interpolate("Hello {name}!", {
      name: null,
    });
    assert.equal(output, "Hello {name}!");
    assert.deepEqual(warnings, ["name"]);
  });

  it("treats an undefined value as missing (warning, placeholder kept)", () => {
    const { output, warnings } = interpolate("Hello {name}!", {
      name: undefined,
    });
    assert.equal(output, "Hello {name}!");
    assert.deepEqual(warnings, ["name"]);
  });

  // ---------------------------------------------------------------------------
  // Value stringification
  // ---------------------------------------------------------------------------

  it("stringifies number values", () => {
    const { output, warnings } = interpolate("Port: {port}", { port: 8080 });
    assert.equal(output, "Port: 8080");
    assert.deepEqual(warnings, []);
  });

  it("stringifies boolean values", () => {
    const { output, warnings } = interpolate("enabled={flag}", { flag: true });
    assert.equal(output, "enabled=true");
    assert.deepEqual(warnings, []);
  });

  it("substitutes an empty string value (distinct from null/missing)", () => {
    const { output, warnings } = interpolate("[{suffix}]", { suffix: "" });
    assert.equal(output, "[]");
    assert.deepEqual(warnings, []);
  });

  it("substitutes the value zero (not treated as missing)", () => {
    const { output, warnings } = interpolate("count={n}", { n: 0 });
    assert.equal(output, "count=0");
    assert.deepEqual(warnings, []);
  });

  it("substitutes the value false (not treated as missing)", () => {
    // Guard against a bug where `!vars[id]` would be used instead of the
    // null/undefined check: `false` must still substitute.
    const { output, warnings } = interpolate("flag={f}", { f: false });
    assert.equal(output, "flag=false");
    assert.deepEqual(warnings, []);
  });

  it("treats special regex characters in the value as literal text ($& / $1 are not back-references)", () => {
    // `String.prototype.replace` interprets `$&`, `$1`, etc. in the REPLACEMENT
    // string. The implementation uses the function form of replace, which is
    // immune to that — verify here so a future refactor to the string form
    // would fail this test.
    const { output, warnings } = interpolate("value={v}", {
      v: "$1 $& $` $'",
    });
    assert.equal(output, "value=$1 $& $` $'");
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Escape sequences
  // ---------------------------------------------------------------------------

  it("unwraps `{{` into a literal `{`", () => {
    const { output, warnings } = interpolate("{{literal}}", {});
    // `{{` → `{`, `literal` is now literal text (no braces around it left
    // by the first escape), `}}` → `}`.
    assert.equal(output, "{literal}");
    assert.deepEqual(warnings, []);
  });

  it("unwraps `}}` into a literal `}` on its own", () => {
    const { output, warnings } = interpolate("end}}", {});
    assert.equal(output, "end}");
    assert.deepEqual(warnings, []);
  });

  it("does not consume variable braces adjacent to an escape sequence", () => {
    // `{{literal}} {var}` — the `{{` and `}}` are escapes, and the `{var}` in
    // between is still a real placeholder that must resolve.
    const { output, warnings } = interpolate("{{literal}} {var}", {
      var: "X",
    });
    assert.equal(output, "{literal} X");
    assert.deepEqual(warnings, []);
  });

  it("escapes take priority over placeholder matching (no misread of `{{x}}`)", () => {
    // `{{x}}` must become `{x}` (two escape tokens around literal `x`), NOT
    // `{` + substituted `{x}` + `}`. The regex alternation order guarantees
    // this; pin it down with a test.
    const { output, warnings } = interpolate("{{x}}", {
      x: "SHOULD_NOT_APPEAR",
    });
    assert.equal(output, "{x}");
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Shapes that must NOT match the identifier regex
  // ---------------------------------------------------------------------------

  it("does not substitute placeholders that contain whitespace inside the braces", () => {
    // `{ name }` is left as-is per TSDoc: whitespace breaks the identifier
    // regex and no warning is produced.
    const { output, warnings } = interpolate("Hello { name }!", {
      name: "World",
    });
    assert.equal(output, "Hello { name }!");
    assert.deepEqual(warnings, []);
  });

  it("leaves a dangling `{` untouched with no warning", () => {
    const { output, warnings } = interpolate("oops {foo and more", {
      foo: "BAR",
    });
    assert.equal(output, "oops {foo and more");
    assert.deepEqual(warnings, []);
  });

  it("leaves empty braces `{}` untouched with no warning", () => {
    const { output, warnings } = interpolate("a {} b", {});
    assert.equal(output, "a {} b");
    assert.deepEqual(warnings, []);
  });

  it("leaves identifiers that start with a digit untouched with no warning", () => {
    // Identifier regex requires `[A-Za-z_]` as the first character.
    const { output, warnings } = interpolate("v={1x}", { "1x": "ignored" });
    assert.equal(output, "v={1x}");
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Allowed identifier characters (dots, hyphens, digits)
  // ---------------------------------------------------------------------------

  it("treats dotted identifiers as flat keys (no nested property access)", () => {
    // Per TSDoc: `{foo.bar}` looks up the literal key "foo.bar", it does NOT
    // drill into vars.foo.bar.
    const nested = { foo: { bar: "NESTED" } } as unknown as Record<
      string,
      unknown
    >;
    const flat = { "foo.bar": "FLAT" };

    const nestedResult = interpolate("{foo.bar}", nested);
    assert.equal(nestedResult.output, "{foo.bar}");
    assert.deepEqual(nestedResult.warnings, ["foo.bar"]);

    const flatResult = interpolate("{foo.bar}", flat);
    assert.equal(flatResult.output, "FLAT");
    assert.deepEqual(flatResult.warnings, []);
  });

  it("allows hyphens and digits inside identifiers (after the first char)", () => {
    const { output, warnings } = interpolate("{pkg-name_2}", {
      "pkg-name_2": "ok",
    });
    assert.equal(output, "ok");
    assert.deepEqual(warnings, []);
  });

  // ---------------------------------------------------------------------------
  // Single-pass guarantee
  // ---------------------------------------------------------------------------

  it("does not re-interpolate a value that itself contains a placeholder (single-pass)", () => {
    const { output, warnings } = interpolate("outer={x}", { x: "{y}", y: "Y" });
    assert.equal(output, "outer={y}");
    assert.deepEqual(warnings, []);
  });
});
