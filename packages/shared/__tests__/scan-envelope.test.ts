import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ScanEnvelope,
  CURRENT_SCHEMA_VERSION,
} from "../src/types/scan-envelope";

describe("ScanEnvelope schema", () => {
  const baseValidEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // `layout` is the raw text of .architecture/layout.yaml -- a string, not a
    // structured object. The web adapter guards on `typeof rec.layout ===
    // "string"` before clipping it, so anything else is silently dropped.
    layout: "contexts:\n  orders:\n    root: packages/orders\n",
    filesScanned: 10,
    reportMarkdown: "# Valid Report",
    error: null,
  };

  it("validates producer-shaped envelope", () => {
    const result = ScanEnvelope.safeParse({
      ...baseValidEnvelope,
      reportMarkdown: "# Producer Report",
      error: null,
    });
    expect(result.success).toBe(true);
  });

  it("validates consumer-shaped envelope", () => {
    const result = ScanEnvelope.safeParse({
      ...baseValidEnvelope,
      reportMarkdown: null,
      error: "Consumer error",
    });
    expect(result.success).toBe(true);
  });

  it("preserves unknown fields", () => {
    const result = ScanEnvelope.safeParse({
      ...baseValidEnvelope,
      customField: "preserved-value",
      anotherExtra: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty("customField", "preserved-value");
      expect(result.data).toHaveProperty("anotherExtra", 42);
    }
  });

  it("rejects envelope missing schemaVersion", () => {
    // Built by deletion rather than destructuring-omit: the `const { x, ...rest }`
    // idiom leaves `x` bound but unused, which this repo's root eslint config
    // rejects (no ignoreRestSiblings, no varsIgnorePattern).
    const invalidEnvelope: Record<string, unknown> = { ...baseValidEnvelope };
    delete invalidEnvelope.schemaVersion;
    expect(ScanEnvelope.safeParse(invalidEnvelope).success).toBe(false);
  });

  // The point of a versioned envelope is that a consumer can refuse a major it
  // does not understand. An earlier revision documented that guarantee but did
  // not implement it -- schemaVersion was an unconstrained z.string(), and
  // CURRENT_SCHEMA_VERSION was exported without ever being referenced.
  describe("schemaVersion major check", () => {
    it("accepts a different minor/patch of the supported major", () => {
      for (const v of ["1.0.0", "1.4.2", "1.0.0-rc.1"]) {
        expect(
          ScanEnvelope.safeParse({ ...baseValidEnvelope, schemaVersion: v })
            .success,
        ).toBe(true);
      }
    });

    it("refuses an unrecognized major", () => {
      for (const v of ["2.0.0", "99.0.0", "0.9.0"]) {
        expect(
          ScanEnvelope.safeParse({ ...baseValidEnvelope, schemaVersion: v })
            .success,
        ).toBe(false);
      }
    });

    it("refuses a non-numeric version", () => {
      for (const v of ["", "not-a-version", "v1.0.0"]) {
        expect(
          ScanEnvelope.safeParse({ ...baseValidEnvelope, schemaVersion: v })
            .success,
        ).toBe(false);
      }
    });
  });

  // The fixture is the artifact BOTH sides' contract tests assert against
  // (BF-0.1), so it has to satisfy this schema -- otherwise producer and
  // consumer can agree with each other and both be wrong.
  it("the golden fixture validates against this schema", () => {
    const fixture = JSON.parse(
      readFileSync(
        path.join(__dirname, "fixtures", "scan-envelope.v1.json"),
        "utf8",
      ),
    );
    const result = ScanEnvelope.safeParse(fixture);
    expect(result.success).toBe(true);
    // And its `layout` must be the string shape the web adapter can actually read.
    expect(typeof fixture.layout).toBe("string");
  });
});
