import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  computePrDiff,
  formatPrComment,
  parseBaseBaselineText,
  parseRenameNameStatus,
  type Rename,
} from "../src/pr-diff.js";
import type {
  BaselineEntry,
  ViolationRecord,
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
  message = "rendered",
): ViolationRecord => ({ rule, file, specifier, message });

describe("parseRenameNameStatus", () => {
  it("reads R* rows and ignores modifications and copies", () => {
    const renames = parseRenameNameStatus(
      [
        "M\tkept.ts",
        "R100\told/a.ts\tnew/a.ts",
        "R095\told/b.ts\tnew/b.ts",
        "C100\tsrc/x.ts\tsrc/x-copy.ts",
        "A\tbrand-new.ts",
        "",
      ].join("\n"),
    );
    assert.deepEqual(renames, [
      { from: "old/a.ts", to: "new/a.ts" },
      { from: "old/b.ts", to: "new/b.ts" },
    ]);
  });
});

describe("computePrDiff", () => {
  const preExisting = entry("npm-package-in-domain", "a.ts", "zod");

  it("comments only violations absent from the remapped base baseline", () => {
    const { introduced, baselineGrowth } = computePrDiff({
      currentViolations: [
        violation("npm-package-in-domain", "a.ts", "zod"),
        violation("npm-package-in-domain", "new.ts", "zod"),
      ],
      currentBaseline: [preExisting],
      baseBaseline: [preExisting],
      renames: [],
    });
    assert.deepEqual(
      introduced.map((v) => v.file),
      ["new.ts"],
    );
    assert.equal(baselineGrowth.length, 0);
  });

  it("does not treat a renamed baselined file as a new violation or as growth", () => {
    const renames: Rename[] = [{ from: "old/a.ts", to: "new/a.ts" }];
    const { introduced, baselineGrowth } = computePrDiff({
      currentViolations: [
        violation("npm-package-in-domain", "new/a.ts", "zod"),
      ],
      currentBaseline: [entry("npm-package-in-domain", "new/a.ts", "zod")],
      baseBaseline: [entry("npm-package-in-domain", "old/a.ts", "zod")],
      renames,
    });
    assert.equal(introduced.length, 0);
    assert.equal(baselineGrowth.length, 0);
  });

  it("machine-enforces baseline growth even when the current ratchet would pass", () => {
    const grown = entry("npm-package-in-domain", "new.ts", "zod");
    const { introduced, baselineGrowth } = computePrDiff({
      currentViolations: [
        violation("npm-package-in-domain", "a.ts", "zod"),
        violation("npm-package-in-domain", "new.ts", "zod"),
      ],
      currentBaseline: [preExisting, grown],
      baseBaseline: [preExisting],
      renames: [],
    });
    assert.deepEqual(
      introduced.map((v) => v.file),
      ["new.ts"],
    );
    assert.deepEqual(
      baselineGrowth.map((e) => e.file),
      ["new.ts"],
    );
  });

  it("is silent when the PR adds no new keys", () => {
    const { introduced, baselineGrowth } = computePrDiff({
      currentViolations: [violation("npm-package-in-domain", "a.ts", "zod")],
      currentBaseline: [preExisting],
      baseBaseline: [preExisting],
      renames: [],
    });
    assert.equal(introduced.length, 0);
    assert.equal(baselineGrowth.length, 0);
    assert.equal(
      formatPrComment({ introduced, baselineGrowth, expired: [] }),
      null,
    );
  });
});

describe("formatPrComment", () => {
  it("renders only this PR's findings and carries the silent-when-clean marker", () => {
    const body = formatPrComment({
      introduced: [violation("r", "f.ts", "s", "Illegal import")],
      baselineGrowth: [entry("r", "g.ts", "")],
      expired: [
        {
          rule: "r",
          file: "h.ts",
          specifier: "",
          expires: "2026-01-01",
          reason: "old",
        },
      ],
    });
    assert.ok(body);
    assert.match(body, /<!-- hexagen-conformance -->/);
    assert.match(body, /New violations \(1\)/);
    assert.match(body, /Baseline growth \(1\)/);
    assert.match(body, /Expired suppressions \(1\)/);
    assert.doesNotMatch(body, /pre-existing-file/);
  });
});

describe("parseBaseBaselineText", () => {
  it("treats a missing base-branch file as an empty baseline", () => {
    assert.deepEqual(parseBaseBaselineText(null), []);
    assert.deepEqual(parseBaseBaselineText("   "), []);
  });
});
