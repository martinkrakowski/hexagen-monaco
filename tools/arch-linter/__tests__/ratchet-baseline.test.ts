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
  mergeSuppressionMetadata,
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

  it("persists reason and expires when present", () => {
    const text = serializeBaseline([
      {
        rule: "r",
        file: "f.ts",
        specifier: "s",
        reason: "tracked debt",
        expires: "2027-01-15",
      },
    ]);
    assert.match(text, /"reason":"tracked debt"/);
    assert.match(text, /"expires":"2027-01-15"/);
    assert.deepEqual(parseBaseline(text).entries[0], {
      rule: "r",
      file: "f.ts",
      specifier: "s",
      reason: "tracked debt",
      expires: "2027-01-15",
    });
  });
});

describe("mergeSuppressionMetadata", () => {
  it("copies reason and expires from the previous file for matching keys", () => {
    const merged = mergeSuppressionMetadata(
      [entry("r", "f.ts", "s")],
      [
        {
          rule: "r",
          file: "f.ts",
          specifier: "s",
          reason: "keep me",
          expires: "2027-01-15",
        },
      ],
    );
    assert.equal(merged[0]?.reason, "keep me");
    assert.equal(merged[0]?.expires, "2027-01-15");
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

  it("rejects unknown entry fields instead of silently dropping them", () => {
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","extra":"informal"}]}',
      /unknown field\(s\) 'extra'/,
    );
  });

  it("treats legacy 'note' as reason so origin/main baselines still parse", () => {
    const parsed = parseBaseline(
      '{"version":1,"entries":[{"rule":"npm-package-in-domain","file":"pkg/x.ts","specifier":"zod","note":"ADR-0054 amendment"}]}',
    );
    assert.equal(parsed.entries[0]?.reason, "ADR-0054 amendment");
    assert.equal(parsed.entries[0] && "note" in parsed.entries[0], false);
  });

  it("prefers reason when both reason and legacy note are present", () => {
    const parsed = parseBaseline(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","reason":"canonical","note":"legacy"}]}',
    );
    assert.equal(parsed.entries[0]?.reason, "canonical");
  });

  it("rejects an empty reason and a malformed expires date", () => {
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","reason":"  "}]}',
      /empty or non-string 'reason'/,
    );
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","expires":"soon"}]}',
      /expires' must be YYYY-MM-DD/,
    );
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","expires":"2026-02-30"}]}',
      /not a real calendar date/,
    );
  });

  it("accepts optional reason and expires and keeps them on the entry", () => {
    const parsed = parseBaseline(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","reason":"tracked debt","expires":"2027-01-15"}]}',
    );
    assert.equal(parsed.entries[0]?.reason, "tracked debt");
    assert.equal(parsed.entries[0]?.expires, "2027-01-15");
  });

  it("rejects extra top-level keys in baseline JSON", () => {
    // Exactly `version` + `entries` — an added key is schema drift, not an
    // extension, and a parser that ignored it would accept files no version
    // of the linter can write or read back faithfully.
    rejects(
      '{"version":1,"entries":[],"schema":"drift"}',
      /unexpected top-level key\(s\) 'schema'/,
    );
    rejects(
      '{"version":1,"entries":[],"note":"sneaky"}',
      /unexpected top-level key\(s\) 'note'/,
    );
    rejects(
      '{"entries":[],"version":1,"extra":true,"another":true}',
      /unexpected top-level key\(s\) 'extra', 'another'/,
    );
    // The exact allowed shape still parses (guard against over-firing).
    const parsed = parseBaseline('{"version":1,"entries":[]}');
    assert.deepEqual(parsed, { version: BASELINE_VERSION, entries: [] });
  });

  it("refuses reserved keys (__proto__, constructor, prototype) in baseline top-level and entry objects", () => {
    // JSON.parse plants `__proto__` as an ordinary OWN property — the check
    // must therefore run on own property names, and the error must name the
    // key. __proto__ at the top level:
    rejects(
      '{"version":1,"entries":[],"__proto__":{"polluted":true}}',
      /reserved key\(s\) '__proto__' at the top level/,
    );
    // …constructor and prototype too:
    rejects(
      '{"version":1,"entries":[],"constructor":null}',
      /reserved key\(s\) 'constructor' at the top level/,
    );
    rejects(
      '{"version":1,"entries":[],"prototype":{}}',
      /reserved key\(s\) 'prototype' at the top level/,
    );
    // And on entry objects — this is where prototype pollution actually
    // lands when the entry is later spread into a fresh object.
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","__proto__":{"polluted":true}}]}',
      /entry 0 has reserved key\(s\) '__proto__'/,
    );
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","constructor":null}]}',
      /entry 0 has reserved key\(s\) 'constructor'/,
    );
    rejects(
      '{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","prototype":"x"}]}',
      /entry 0 has reserved key\(s\) 'prototype'/,
    );
  });

  it("rejects baseline files exceeding the maximum entry count or string field length bounds", () => {
    // Entry count is explicitly bounded.
    const tooManyEntries = `{"version":1,"entries":[${Array.from(
      { length: 1001 },
      () => '{"rule":"r","file":"f.ts","specifier":"s"}',
    ).join(",")}]}`;
    rejects(tooManyEntries, /'entries' has 1001 items, exceeding the maximum of/);
    // So is every entry string field…
    const longFile = "f".repeat(2049);
    rejects(
      `{"version":1,"entries":[{"rule":"r","file":"${longFile}","specifier":"s"}]}`,
      /'file' exceeds the maximum length/,
    );
    const longRule = "r".repeat(2049);
    rejects(
      `{"version":1,"entries":[{"rule":"${longRule}","file":"f.ts","specifier":"s"}]}`,
      /'rule' exceeds the maximum length/,
    );
    rejects(
      `{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"${"s".repeat(2049)}"}]}`,
      /'specifier' exceeds the maximum length/,
    );
    // …including the suppression fields…
    rejects(
      `{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","reason":"${"y".repeat(2049)}"}]}`,
      /'reason' exceeds the maximum length/,
    );
    rejects(
      `{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","note":"${"y".repeat(2049)}"}]}`,
      /'note' exceeds the maximum length/,
    );
    rejects(
      `{"version":1,"entries":[{"rule":"r","file":"f.ts","specifier":"s","expires":"${"2".repeat(2049)}"}]}`,
      /'expires' exceeds the maximum length/,
    );
    // …and the bounds are strict: exactly-at-limit values still parse.
    const parsed = parseBaseline(
      `{"version":1,"entries":[{"rule":"${"r".repeat(2048)}","file":"${"f".repeat(2048)}","specifier":"${"s".repeat(2048)}","reason":"${"y".repeat(2048)}"}]}`,
    );
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0]?.file.length, 2048);
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

  it("treats an expired suppression as a gate failure, not a suppress", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const { fresh, baselined, expired } = partitionAgainstBaseline(
      [violation("npm-package-in-domain", "a.ts", "zod")],
      [
        {
          rule: "npm-package-in-domain",
          file: "a.ts",
          specifier: "zod",
          reason: "was accepted",
          expires: "2026-01-01",
        },
      ],
      now,
    );
    assert.equal(fresh.length, 1);
    assert.equal(baselined.length, 0);
    assert.equal(expired.length, 1);
    assert.equal(expired[0]?.expires, "2026-01-01");
  });

  it("fails the gate on an expired entry even when the finding is gone", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const { stale, expired } = partitionAgainstBaseline(
      [],
      [
        {
          rule: "npm-package-in-domain",
          file: "a.ts",
          specifier: "zod",
          expires: "2026-01-01",
        },
      ],
      now,
    );
    assert.equal(stale.length, 0);
    assert.equal(expired.length, 1);
  });

  it("keeps a same-day expiry valid through the end of that UTC day", () => {
    const now = new Date("2026-08-17T23:59:59.000Z");
    const { baselined, expired } = partitionAgainstBaseline(
      [violation("npm-package-in-domain", "a.ts", "zod")],
      [
        {
          rule: "npm-package-in-domain",
          file: "a.ts",
          specifier: "zod",
          expires: "2026-08-17",
        },
      ],
      now,
    );
    assert.equal(baselined.length, 1);
    assert.equal(expired.length, 0);
  });
});
