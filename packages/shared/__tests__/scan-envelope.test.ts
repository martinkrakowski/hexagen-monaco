import { describe, it, expect } from "vitest";
import { ScanEnvelope } from "../src/types/scan-envelope";

describe("ScanEnvelope schema", () => {
  const baseValidEnvelope = {
    schemaVersion: "1.0.0",
    layout: { content: "test-layout" },
    filesScanned: 10,
    reportMarkdown: "# Valid Report",
    error: null,
  };

  it("validates producer-shaped envelope", () => {
    const producerEnvelope = {
      ...baseValidEnvelope,
      reportMarkdown: "# Producer Report",
      error: null,
    };
    const result = ScanEnvelope.safeParse(producerEnvelope);
    expect(result.success).toBe(true);
  });

  it("validates consumer-shaped envelope", () => {
    const consumerEnvelope = {
      ...baseValidEnvelope,
      reportMarkdown: null,
      error: "Consumer error",
    };
    const result = ScanEnvelope.safeParse(consumerEnvelope);
    expect(result.success).toBe(true);
  });

  it("preserves unknown fields", () => {
    const envelopeWithExtra = {
      ...baseValidEnvelope,
      customField: "preserved-value",
      anotherExtra: 42,
    };
    const result = ScanEnvelope.safeParse(envelopeWithExtra);
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
    const result = ScanEnvelope.safeParse(invalidEnvelope);
    expect(result.success).toBe(false);
  });
});
