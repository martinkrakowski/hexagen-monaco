import { describe, expect, it } from "vitest";
import {
  decodeProposal,
  PROPOSAL_DISPLAY_CAP_BYTES,
} from "../right/proposal-text";
import { deriveRightPanel } from "../right/derive";
import {
  BUNDLE_TIME,
  grantDoc,
  loadSpec,
  missingLine,
  traceLine,
} from "./right-fixtures";

describe("decodeProposal", () => {
  it("decodes valid UTF-8 untouched", () => {
    const d = decodeProposal(new TextEncoder().encode("héllo\n"));
    expect(d).toMatchObject({
      text: "héllo\n",
      replaced: false,
      truncated: false,
    });
  });

  it("decodes invalid UTF-8 with replacement characters and flags it", () => {
    const d = decodeProposal(new Uint8Array([0x61, 0xff, 0x62]));
    expect(d.text).toBe("a�b");
    expect(d.replaced).toBe(true);
  });

  it("truncates at the cap on a character boundary", () => {
    const bytes = new TextEncoder().encode(
      "é".repeat(PROPOSAL_DISPLAY_CAP_BYTES),
    );
    const d = decodeProposal(bytes);
    expect(d.truncated).toBe(true);
    expect(d.totalBytes).toBe(bytes.length);
    expect(d.shownBytes).toBeLessThanOrEqual(PROPOSAL_DISPLAY_CAP_BYTES);
    expect(d.text.length).toBeGreaterThan(0);
    expect(d.text).not.toContain("�");
    expect(d.replaced).toBe(false);
  });
});

describe("deriveRightPanel: the active grant", () => {
  it("is the grant the latest grant-bearing trace line cites", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [
          grantDoc({ id: "g1" }),
          grantDoc({ id: "g2", agent: "other" }),
        ],
        trace: [
          traceLine({ grant_id: "g1", seq: 0 }),
          traceLine({ grant_id: "g2", seq: 1 }),
          missingLine({ seq: 2 }),
        ],
      }),
    );
    expect(v.activeGrantId).toBe("g2");
    expect(v.activeNote).toBeNull();
  });

  it("is unknown when no trace line names a bundled grant", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [grantDoc({ id: "g1" }), grantDoc({ id: "g2" })],
        trace: [traceLine({ grant_id: "gX" })],
      }),
    );
    expect(v.activeGrantId).toBeNull();
    expect(v.activeNote).toMatch(/cannot tell/i);
    expect(v.grants.map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});

describe("deriveRightPanel: expiry is judged at bundle time", () => {
  it("never reads the wall clock", async () => {
    const bundle = await loadSpec({
      grants: [
        grantDoc({ id: "early", expires_at: "2026-10-01T09:00:00.000Z" }),
        grantDoc({ id: "late", expires_at: "2026-10-01T12:00:00.000Z" }),
      ],
    });
    const at = (iso: string) => {
      const real = Date.now;
      Date.now = () => Date.parse(iso);
      try {
        return deriveRightPanel(bundle).grants.map((g) => g.expiredAtBundle);
      } finally {
        Date.now = real;
      }
    };
    expect(at("2020-01-01T00:00:00Z")).toEqual([true, false]);
    expect(at("2040-01-01T00:00:00Z")).toEqual([true, false]);
    expect(deriveRightPanel(bundle).bundleTime).toBe(BUNDLE_TIME);
  });
});

describe("deriveRightPanel: denials", () => {
  it("keeps exactly the lines that carry a denial code", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        trace: [
          traceLine({ seq: 0 }),
          traceLine({ seq: 1, halt_reason: "grant_denied" }),
          traceLine({ seq: 2, halt_reason: "grant_expired" }),
          traceLine({ seq: 3, halt_reason: "grant_revoked" }),
          traceLine({ seq: 4, halt_reason: "error" }),
          missingLine({ seq: 5 }),
          "not json",
        ],
      }),
    );
    expect(v.denials.map((d) => [d.seq, d.code])).toEqual([
      [1, "grant_denied"],
      [2, "grant_expired"],
      [3, "grant_revoked"],
      [5, "grant_missing"],
    ]);
  });
});
