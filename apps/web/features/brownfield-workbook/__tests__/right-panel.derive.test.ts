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

  it("backs the cap up to a character boundary", () => {
    const bytes = new TextEncoder().encode(
      "a" + "é".repeat(PROPOSAL_DISPLAY_CAP_BYTES),
    );
    const d = decodeProposal(bytes);
    expect(d.truncated).toBe(true);
    expect(d.totalBytes).toBe(bytes.length);
    // The cap lands on a continuation byte, so one byte is given back.
    expect(d.shownBytes).toBe(PROPOSAL_DISPLAY_CAP_BYTES - 1);
    expect(d.text.length).toBeGreaterThan(0);
    expect(d.text).not.toContain("\uFFFD");
    expect(d.replaced).toBe(false);
  });

  it("gives back at most three bytes (a UTF-8 character is at most four)", () => {
    const bytes = new Uint8Array(PROPOSAL_DISPLAY_CAP_BYTES + 10).fill(0x80);
    const d = decodeProposal(bytes);
    expect(d.shownBytes).toBe(PROPOSAL_DISPLAY_CAP_BYTES - 3);
    expect(d.replaced).toBe(true);
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

describe("deriveRightPanel: the active grant, strictly", () => {
  it("is unknown when the latest grant-bearing line cites a grant that is not bundled, with no walking back", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [grantDoc({ id: "g1" }), grantDoc({ id: "g2" })],
        trace: [
          traceLine({ grant_id: "g2" }),
          traceLine({ grant_id: "gX" }),
          missingLine(),
        ],
      }),
    );
    expect(v.activeGrantId).toBeNull();
    expect(v.activeNote).toMatch(/cannot tell/i);
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

describe("deriveRightPanel: the window boundary", () => {
  const at = (ms: number) =>
    new Date(Date.parse(BUNDLE_TIME) + ms).toISOString();
  it("treats expires_at == bundle time as in-window, one ms earlier as expired", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [
          grantDoc({ id: "eq", expires_at: BUNDLE_TIME }),
          grantDoc({ id: "before", expires_at: at(-1) }),
          grantDoc({ id: "after", expires_at: at(1) }),
        ],
      }),
    );
    expect(v.grants.map((g) => [g.id, g.expiredAtBundle])).toEqual([
      ["eq", false],
      ["before", true],
      ["after", false],
    ]);
  });

  it("treats revoked_at == bundle time as revoked, one ms later as not", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [
          grantDoc({ id: "eq", revoked_at: BUNDLE_TIME }),
          grantDoc({ id: "after", revoked_at: at(1) }),
          grantDoc({ id: "before", revoked_at: at(-1) }),
        ],
      }),
    );
    expect(v.grants.map((g) => [g.id, g.revokedAtBundle])).toEqual([
      ["eq", true],
      ["after", false],
      ["before", true],
    ]);
  });

  it("flags a missing or unparseable expiry", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        grants: [
          grantDoc({ id: "none", expires_at: undefined }),
          grantDoc({ id: "bad", expires_at: "soon" }),
          grantDoc({ id: "ok" }),
        ],
      }),
    );
    expect(v.grants.map((g) => g.expiryUnreadable)).toEqual([
      true,
      true,
      false,
    ]);
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

  it("numbers a line by its index, as the pack does, not by its own seq field", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        trace: [
          traceLine({ seq: 40 }),
          traceLine({ seq: 99, halt_reason: "grant_denied" }),
        ],
      }),
    );
    expect(v.denials.map((d) => d.seq)).toEqual([1]);
  });

  it("takes the time from the line, and a reason only from grant_missing", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        trace: [
          traceLine({
            halt_reason: "grant_denied",
            tool_calls: [
              {
                name: "t",
                args_digest: "a",
                result_digest: "b",
                time: "2026-10-01T09:30:00.000Z",
              },
            ],
          }),
          missingLine({ time: "2026-10-01T09:31:00.000Z" }),
        ],
        verdictDenials: [
          { seq: 0, haltReason: "grant_denied", reason: "invented" },
        ],
      }),
    );
    expect(v.denials.map((d) => [d.time, d.reason])).toEqual([
      ["2026-10-01T09:30:00.000Z", null],
      ["2026-10-01T09:31:00.000Z", "no grant supplied"],
    ]);
  });

  it("counts non-denial halts (such as error) apart", async () => {
    const v = deriveRightPanel(
      await loadSpec({
        trace: [
          traceLine({ halt_reason: "error" }),
          traceLine({ halt_reason: "completed" }),
          traceLine({ halt_reason: "grant_denied" }),
        ],
      }),
    );
    expect(v.otherHaltLines).toBe(1);
    expect(v.denials).toHaveLength(1);
  });
});
