import { describe, expect, it } from "vitest";
import { buildState } from "../../src/domain/decision-advice";

const FILLER = "consectetur adipiscing elit "; // spaces break secret-shape patterns

function valueOfLength(bytes: number): string {
  return FILLER.repeat(Math.ceil(bytes / FILLER.length)).slice(0, bytes);
}

describe("buildState", () => {
  it("joins the hash line and the declared fields", () => {
    const result = buildState(
      [
        { name: "project", value: "bike-rental" },
        { name: "c0.name", value: "Rentals" },
      ],
      "gen-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toBe("hash: gen-1\nproject: bike-rental\nc0.name: Rentals");
    }
  });

  it("accepts a field just under the 8 KiB per-field cap", () => {
    const result = buildState([{ name: "f", value: valueOfLength(8 * 1024 - 4) }], "h");
    expect(result.ok).toBe(true);
  });

  it("refuses a field over the 8 KiB per-field cap", () => {
    const result = buildState([{ name: "f", value: valueOfLength(8 * 1024) }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  it("refuses when the total exceeds 32 KiB even with each field under its cap", () => {
    // 5 fields × (2 bytes overhead + 7000 bytes) ≈ 35 KiB total, each field < 8 KiB.
    const fields = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}`,
      value: valueOfLength(7000),
    }));
    const result = buildState(fields, "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  it("accepts a total just under the 32 KiB cap", () => {
    // 4 fields of 8181 bytes plus "f<i>: " overhead: 7 + 4 × 8186 = 32751 total.
    const fields = Array.from({ length: 4 }, (_, i) => ({
      name: `f${i}`,
      value: valueOfLength(8181),
    }));
    const result = buildState(fields, "h");
    expect(result.ok).toBe(true);
  });

  const secretSamples: [string, string][] = [
    ["openrouter key", "sk-or-v1-0123456789abcdef"],
    ["generic sk key", "sk-proj-abcdefghij0123456789"],
    ["github classic token", "ghp_0123456789abcdefghij"],
    ["github fine-grained token", "github_pat_11ABCdef0_0123456789"],
    ["aws access key id", "AKIA0123456789ABCDEF"],
    ["pem key header", "-----BEGIN RSA PRIVATE KEY-----"],
    ["slack bot token", "xoxb-123456789012-abcdefghij"],
    ["slack user token", "xoxp-123456789012-abcdefghij"],
    ["long high-entropy hex", "d41d8cd98f00b204e9800998ecf8427e"],
    ["long high-entropy base64", "c3VwZXJzZWNyZXRiYXNlNjRzdHJpbmdvbG9vbG9vbA=="],
  ];

  it.each(secretSamples)("refuses a %s in a field value", (_label, secret) => {
    const result = buildState([{ name: "field", value: `text ${secret} tail` }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  it("refuses a secret in a field name", () => {
    const result = buildState([{ name: "ghp_0123456789abcdefghij", value: "x" }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  it("never redacts — a refused state carries no truncated output", () => {
    const secret = "sk-or-v1-0123456789abcdef";
    const result = buildState([{ name: "field", value: secret }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
    if (!result.ok) {
      expect(result).not.toHaveProperty("state");
    }
  });
});