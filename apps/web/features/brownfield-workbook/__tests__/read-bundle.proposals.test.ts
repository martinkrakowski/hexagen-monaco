import { describe, expect, it } from "vitest";
import { readBundle } from "../bundle/read-bundle";
import { buildBundle, validFiles } from "./bundle-fixtures";

describe("readBundle: proposal bytes", () => {
  it("keeps each proposal's raw bytes, sha-checked, beside the path list", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]);
    const r = await readBundle(
      await buildBundle([
        ...validFiles(),
        { path: "proposals/x.patch", role: "proposal", content: bytes },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.proposals).toEqual(["proposals/x.patch"]);
    expect(
      Array.from(r.bundle.proposalFiles.get("proposals/x.patch") ?? []),
    ).toEqual(Array.from(bytes));
  });

  it("still refuses a proposal whose bytes do not match the index", async () => {
    const r = await readBundle(
      await buildBundle(
        [
          ...validFiles(),
          { path: "proposals/x.patch", role: "proposal", content: "abc" },
        ],
        { badSha: { "proposals/x.patch": "1".repeat(64) } },
      ),
    );
    expect(r.ok).toBe(false);
  });
});
