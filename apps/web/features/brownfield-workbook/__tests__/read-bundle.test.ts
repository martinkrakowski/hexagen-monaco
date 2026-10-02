import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { readBundle } from "../bundle/read-bundle";
import {
  buildBundle,
  lieAboutSize,
  markSymlink,
  renameEntry,
  validFiles,
} from "./bundle-fixtures";

async function refused(
  data: Uint8Array,
  limits?: Parameters<typeof readBundle>[1],
) {
  const r = await readBundle(data, limits);
  if (r.ok) throw new Error("expected a refusal");
  return r.errors.join("\n");
}

describe("readBundle: a valid bundle", () => {
  it("parses every listed file and exposes the typed documents", async () => {
    const r = await readBundle(await buildBundle());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.index.sliceId).toBe("slice-1");
    expect(r.bundle.slice?.id).toBe("slice-1");
    expect(r.bundle.contract?.sliceId).toBe("slice-1");
    expect(r.bundle.observed?.packages.collected).toBe(true);
    expect(r.bundle.grants.map((g) => g.path)).toEqual(["grants/0-g1.json"]);
    expect(r.bundle.texts.get("slice.json")).toContain("slice-1");
  });
});

describe("readBundle: unsafe entry names", () => {
  const cases: [string, string, string][] = [
    ["a parent segment", "slice.json", "../ce.json"],
    ["an absolute path", "slice.json", "/lice.json"],
    ["a backslash", "slice.json", "s\\ice.json"],
    ["a drive path", "slice.json", "C:/ce.json"],
    ["a NUL byte", "slice.json", "s\0ice.json"],
  ];
  for (const [label, from, to] of cases) {
    it(`refuses ${label}`, async () => {
      const zip = renameEntry(await buildBundle(), from, to);
      expect(await refused(zip)).toMatch(/unsafe/i);
    });
  }

  it("refuses duplicate entry names", async () => {
    const files = [
      ...validFiles(),
      { path: "aa.json", role: "proposal", content: "x" },
      { path: "bb.json", role: "proposal", content: "x" },
    ];
    const zip = renameEntry(await buildBundle(files), "bb.json", "aa.json");
    expect(await refused(zip)).toMatch(/duplicate/i);
  });

  it("refuses a symlink entry", async () => {
    const zip = markSymlink(await buildBundle(), "slice.json");
    expect(await refused(zip)).toMatch(/symlink/i);
  });
});

describe("readBundle: caps", () => {
  it("refuses too many entries", async () => {
    const msg = await refused(await buildBundle(), { maxEntries: 3 });
    expect(msg).toMatch(/too many entries/i);
  });

  it("refuses an entry over the per-entry cap, from the declared size", async () => {
    const msg = await refused(await buildBundle(), { maxEntryBytes: 50 });
    expect(msg).toMatch(/entry/i);
    expect(msg).toMatch(/exceeds/i);
  });

  const bigTrace = async () =>
    buildBundle(
      validFiles().map((f) =>
        f.path === "evidence/trace.jsonl"
          ? { ...f, content: "a".repeat(100_000) }
          : f,
      ),
    );

  it("refuses when the declared total exceeds the aggregate cap", async () => {
    const msg = await refused(await bigTrace(), {
      maxEntries: 20,
      maxEntryBytes: 200_000,
      maxTotalBytes: 50_000,
    });
    expect(msg).toMatch(/declared total/i);
  });

  it("stops inflating mid-stream when an entry lies about its size", async () => {
    const zip = lieAboutSize(await bigTrace(), "evidence/trace.jsonl", 10);
    const msg = await refused(zip, {
      maxEntries: 20,
      maxEntryBytes: 5_000,
      maxTotalBytes: 50_000,
    });
    expect(msg).toMatch(/entry .*exceeds/i);
  });

  it("stops inflating when the actual total passes the aggregate cap", async () => {
    const zip = lieAboutSize(await bigTrace(), "evidence/trace.jsonl", 10);
    const msg = await refused(zip, {
      maxEntries: 20,
      maxEntryBytes: 200_000,
      maxTotalBytes: 50_000,
    });
    expect(msg).toMatch(/total size exceeds/i);
  });

  it("refuses on the declared size alone, before inflating anything", async () => {
    const zip = lieAboutSize(await buildBundle(), "slice.json", 9_000_000);
    const msg = await refused(zip, {
      maxEntries: 20,
      maxEntryBytes: 5_000,
      maxTotalBytes: 100_000_000,
    });
    expect(msg).toMatch(/entry .*exceeds/i);
  });

  it("refuses a file larger than the total cap before reading it", async () => {
    const msg = await refused(new Uint8Array(1000), { maxTotalBytes: 100 });
    expect(msg).toMatch(/too large/i);
  });
});

describe("readBundle: the index", () => {
  it("refuses a sha mismatch", async () => {
    const zip = await buildBundle(validFiles(), {
      badSha: { "slice.json": "f".repeat(64) },
    });
    expect(await refused(zip)).toMatch(/slice\.json.*sha256/i);
  });

  it("refuses an extra, unlisted entry", async () => {
    const zip = await buildBundle(validFiles(), {
      extra: [{ name: "stowaway.txt", content: "x" }],
    });
    expect(await refused(zip)).toMatch(/stowaway\.txt.*not listed/i);
  });

  it("refuses a listed entry that is missing", async () => {
    const zip = await buildBundle(validFiles(), { omit: ["contract.json"] });
    expect(await refused(zip)).toMatch(/contract\.json.*missing/i);
  });

  it("refuses a missing bundle.json", async () => {
    const z = new JSZip();
    z.file("slice.json", "{}");
    const zip = await z.generateAsync({ type: "uint8array" });
    expect(await refused(zip)).toMatch(/bundle\.json/);
  });

  it("refuses an index that fails the BW0 schema", async () => {
    const z = new JSZip();
    z.file("bundle.json", JSON.stringify({ schemaVersion: "1.0.0" }));
    const zip = await z.generateAsync({ type: "uint8array" });
    expect(await refused(zip)).toMatch(/bundle\.json.*valid/i);
  });

  it("refuses a listed document that fails its schema", async () => {
    const files = validFiles().map((f) =>
      f.path === "slice.json" ? { ...f, content: '{"nope":1}' } : f,
    );
    expect(await refused(await buildBundle(files))).toMatch(
      /slice\.json.*valid/i,
    );
  });

  it("refuses bytes that are not a zip", async () => {
    expect(await refused(new TextEncoder().encode("not a zip"))).toMatch(
      /zip/i,
    );
  });
});
