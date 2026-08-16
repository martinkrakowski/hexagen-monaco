/**
 * The ratchet baseline (ADR-0054 §1) — key stability, fail-closed parsing, and
 * the serialization contract the burn-down discipline depends on.
 *
 * The properties pinned here are the ones a reviewer relies on but cannot see:
 *  - the key is `rule|file|specifier`, NOT the rendered message, so re-wording a
 *    diagnostic does not silently invalidate (or silently extend) the baseline;
 *  - a malformed baseline throws instead of degrading to "empty" — degrading
 *    either way changes what CI enforces while still reporting a verdict;
 *  - the file is written one entry per line, sorted, so a remediation PR's
 *    burn-down reads as deleted lines.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  BASELINE_VERSION,
  parseBaseline,
  partitionAgainstBaseline,
  serializeBaseline,
  violationKey,
  type BaselineEntry,
  type ViolationRecord,
} from "../src/ratchet-baseline.js";

const entry = (
  rule: string,
  file: string,
  specifier: string,
): BaselineEntry => ({ rule, file, specifier });

const violation = (
  rule: string,
  file: string,
  specifier: string,
  message = "rendered text",
): ViolationRecord => ({ rule, file, specifier, message });

describe("violationKey", () => {
  it("ignores the rendered message", () => {
    assert.equal(
      violationKey(violation("r", "f.ts", "s", "one wording")),
      violationKey(violation("r", "f.ts", "s", "a different wording")),
    );
  });

  it("separates the three fields unambiguously", () => {
    assert.notEqual(
      violationKey(entry("a", "b c", "d")),
      violationKey(entry("a", "b", "c d")),
    );
  });
});

describe("serializeBaseline", () => {
  it("sorts, de-duplicates, and writes one entry per line", () => {
    const text = serializeBaseline([
      entry("npm-package-in-domain", "b.ts", "zod"),
      entry("cross-layer-relative-import", "a.ts", "../infra/x.js"),
      entry("npm-package-in-domain", "b.ts", "zod"),
    ]);
    const lines = text.split("\n");
    const entryLines = lines.filter((l) => l.trim().startsWith('{"rule"'));
    assert.equal(entryLines.length, 2, text);
    assert.match(entryLines[0], /cross-layer-relative-import/);
    assert.match(entryLines[1], /npm-package-in-domain/);
    assert.ok(text.endsWith("\n"), "must end with a newline");
    // Round-trips through the parser.
    assert.equal(parseBaseline(text).entries.length, 2);
  });

  it("writes a valid, parseable file for an empty violation set", () => {
    const text = serializeBaseline([]);
    assert.deepEqual(parseBaseline(text), {
      version: BASELINE_VERSION,
      entries: [],
    });
  });

  it("drops the display message from what is persisted", () => {
    const text = serializeBaseline([
      violation("r", "f.ts", "s", "SHOULD-NOT-BE-PERSISTED"),
    ]);
    assert.doesNotMatch(text, /SHOULD-NOT-BE-PERSISTED/);
  });
});

describe("parseBaseline — fail closed", () => {
  const rejects = (text: string, expected: RegExp) =>
    assert.throws(() => parseBaseline(text), expected, text);

  it("rejects malformed or wrong-shaped files instead of defaulting to empty", () => {
    rejects("{not json", /not valid JSON/);
    rejects("[]", /expected a JSON object/);
    rejects('{"entries":[]}', /missing numeric 'version'/);
    rejects('{"version":1}', /missing 'entries' array/);
    rejects('{"version":1,"entries":[1]}', /entry 0 is not an object/);
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f"}]}',
      /entry 0 has no string 'specifier'/,
    );
  });

  it("rejects a future baseline version rather than half-reading it", () => {
    rejects('{"version":99,"entries":[]}', /unsupported baseline version 99/);
  });
});

describe("partitionAgainstBaseline", () => {
  const baseline = [
    entry("npm-package-in-domain", "a.ts", "zod"),
    entry("node-builtin-in-layer", "b.ts", "node:fs"),
  ];

  it("suppresses baselined findings and surfaces new ones", () => {
    const { fresh, baselined, stale } = partitionAgainstBaseline(
      [
        violation("npm-package-in-domain", "a.ts", "zod"),
        violation("npm-package-in-domain", "c.ts", "zod"),
      ],
      baseline,
    );
    assert.deepEqual(
      fresh.map((v) => v.file),
      ["c.ts"],
    );
    assert.deepEqual(
      baselined.map((v) => v.file),
      ["a.ts"],
    );
    // The builtin entry no longer reproduces → stale, ready to be deleted.
    assert.deepEqual(
      stale.map((e) => e.file),
      ["b.ts"],
    );
  });

  it("treats the same rule in a new file as a regression, not a match", () => {
    const { fresh } = partitionAgainstBaseline(
      [violation("node-builtin-in-layer", "b2.ts", "node:fs")],
      baseline,
    );
    assert.equal(fresh.length, 1);
  });

  it("treats a different specifier in a baselined file as a regression", () => {
    const { fresh } = partitionAgainstBaseline(
      [violation("npm-package-in-domain", "a.ts", "js-yaml")],
      baseline,
    );
    assert.equal(fresh.length, 1);
  });

  it("enforces everything when the baseline is empty", () => {
    const { fresh, stale } = partitionAgainstBaseline(
      [violation("npm-package-in-domain", "a.ts", "zod")],
      [],
    );
    assert.equal(fresh.length, 1);
    assert.equal(stale.length, 0);
  });
});
