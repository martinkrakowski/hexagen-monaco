import { describe, expect, it } from "vitest";
import { buildState } from "../../src/domain/decision-advice";

const FILLER = "consectetur adipiscing elit "; // spaces break secret-shape patterns

function valueOfLength(bytes: number): string {
  return FILLER.repeat(Math.ceil(bytes / FILLER.length)).slice(0, bytes);
}

describe("buildState", () => {
  it("joins the declared fields without the hash line", () => {
    const result = buildState(
      [
        { name: "project", value: "bike-rental" },
        { name: "c0.name", value: "Rentals" },
      ],
      "gen-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toBe("project: bike-rental\nc0.name: Rentals");
      expect(result.hash).toBe("gen-1");
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

  // Kept deliberately fake: every sample is assembled from inert string
  // pieces so no real credential ever appears in the source tree.
  const secretSamples: [string, string][] = [
    ["openrouter key", ["sk-or-v1-", "0123456789abcdef0123456789abcdef0123456789abcdef"].join("")],
    ["generic sk key", ["sk-proj-", "abcdefghij0123456789"].join("")],
    ["stripe live key", ["sk", "live", "0123456789abcdef01234567"].join("_")],
    ["stripe test key", ["sk", "test", "0123456789abcdef01234567"].join("_")],
    ["google api key", ["AIza", "0AaB_-0AaB_-0AaB_-0AaB_-0AaB_-0AaB_"].join("")],
    ["npm token", ["npm_", "0123456789abcdefghijklmnopqrstuvwxyzAB"].join("")],
    ["github classic token", ["ghp_", "0123456789abcdefghij"].join("")],
    ["github fine-grained token", ["github_pat_11ABCdef0_", "0123456789"].join("")],
    ["github app token", ["gho_", "0123456789abcdefghij"].join("")],
    ["github user token", ["ghu_", "0123456789abcdefghij"].join("")],
    ["gitlab token", ["glpat-", "0123abcdefghij0123"].join("")],
    ["aws access key id", ["AKIA", "0123456789ABCDEF"].join("")],
    ["aws session key id", ["ASIA", "0123456789ABCDEF01"].join("")],
    ["pem key header", ["-----BEGIN ", "RSA PRIVATE KEY-----"].join("")],
    ["slack app token", ["xoxa-", "123456789012-abcdefghij"].join("")],
    ["slack bot token", ["xoxb-", "123456789012-abcdefghij"].join("")],
    ["slack user token", ["xoxp-", "123456789012-abcdefghij"].join("")],
    ["slack refresh token", ["xoxr-", "123456789012-abcdefghij"].join("")],
    ["long high-entropy hex", "d41d8cd98f00b204e9800998ecf8427e"],
    [
      "long high-entropy base64",
      // 44 chars, mixed case with digits — the shape the base64 rule targets.
      ["Ab1", "cD2", "eF3", "gH4", "iJ5", "kL6", "mN7", "oP8", "qR9", "sT0", "uV1", "wX2", "yZ3", "aB4", "cD5"].join(""),
    ],
    [
      "jwt",
      [
        "eyJhbGciOiJIUzI1NiJ9",
        "eyJ0eXAiOiJKV1QifQ",
        "c2lnbmF0dXJlX2hlcmU",
      ].join("."),
    ],
  ];

  it.each(secretSamples)("refuses a %s in a field value", (_label, secret) => {
    const result = buildState([{ name: "field", value: `text ${secret} tail` }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  // Ordinary project identifiers share surface shapes with the `sk-` secret
  // prefixes; the left alphanumeric boundary keeps them accepted.
  const plainIdentifiers = [
    "task-scheduling-service",
    "risk-assessment-engine",
    "CustomerSubscriptionRenewalNotificationScheduler",
    "OAuth2ClientCredentialsGrantTokenProviderFactory",
    "InventoryReplenishmentForecastingAggregate",
    "apps/web/app/api/manifest/generate/spec/route",
  ];

  it.each(plainIdentifiers)("accepts the plain identifier %s", (identifier) => {
    const result = buildState([{ name: "field", value: identifier }], "h");
    expect(result.ok).toBe(true);
  });

  it("refuses a secret in a field name", () => {
    const result = buildState([{ name: ["ghp_", "0123456789", "abcdefghij"].join(""), value: "x" }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
  });

  it("never redacts — a refused state carries no truncated output", () => {
    const secret = ["sk-or-", "v1-", "0123456789abcdef"].join("");
    const result = buildState([{ name: "field", value: secret }], "h");
    expect(result).toEqual({ ok: false, reason: "refused" });
    if (!result.ok) {
      expect(result).not.toHaveProperty("state");
    }
  });
});