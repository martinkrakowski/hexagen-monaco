import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { writeZipStore } from "../../../../../packages/sync/src/commands/report/zip-store";
import { readBundle } from "../bundle/read-bundle";
import {
  buildBundle,
  damageCentralDirectory,
  markDirectoryByAttrs,
  markEncrypted,
  patchEocd16,
  renameLocalOnly,
  sha,
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
    const r = await readBundle(zip, {
      maxEntries: 20,
      maxEntryBytes: 5_000,
      maxTotalBytes: 50_000,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toMatch(/entry .*exceeds/i);
    // Streaming proof: nowhere near the 100 000 bytes the entry holds.
    expect(r.bytesRead).toBeDefined();
    expect(r.bytesRead as number).toBeLessThanOrEqual(5_000 + 16 * 1024);
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

  it("refuses a contract whose known violation expires on an impossible date", async () => {
    const files = validFiles().map((f) =>
      f.path === "contract.json"
        ? {
            ...f,
            content: JSON.stringify({
              schemaVersion: "1.0.0",
              sliceId: "slice-1",
              rules: [],
              knownViolations: [
                {
                  rule: "r",
                  file: "a.ts",
                  specifier: "x",
                  expires: "2026-02-30",
                },
              ],
            }),
          }
        : f,
    );
    expect(await refused(await buildBundle(files))).toMatch(
      /contract\.json.*not a valid contract/i,
    );
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

describe("readBundle: BW7a's real writer", () => {
  it("opens a bundle written by writeZipStore", async () => {
    const files = validFiles();
    const index = {
      schemaVersion: "1.0.0",
      createdAt: "2026-10-01T10:00:00.000Z",
      sliceId: "slice-1",
      files: files.map((f) => ({
        path: f.path,
        role: f.role,
        sha256: sha(f.content),
      })),
      hmac: "0".repeat(64),
    };
    const zip = writeZipStore([
      { name: "bundle.json", content: JSON.stringify(index) },
      ...files.map((f) => ({ name: f.path, content: f.content })),
    ]);
    const r = await readBundle(new Uint8Array(zip));
    expect(r.ok).toBe(true);
  });
});

describe("readBundle: container-level refusals", () => {
  it("refuses an encrypted entry", async () => {
    const zip = markEncrypted(await buildBundle(), "slice.json");
    expect(await refused(zip)).toMatch(/encrypted/i);
  });

  it("refuses zip64 markers in the end record", async () => {
    for (const offset of [4, 6, 8, 10] as const) {
      const zip = patchEocd16(await buildBundle(), offset, 0xffff);
      expect(await refused(zip), "offset " + offset).toMatch(/zip64/i);
    }
  });

  it("refuses a directory entry with its own message", async () => {
    const zip = await buildBundle(validFiles(), {
      extra: [{ name: "somedir/", content: "" }],
    });
    expect(await refused(zip)).toMatch(/directory entry/i);
  });

  for (const kind of ["unix", "dos"] as const) {
    it(`refuses an entry that is a directory by ${kind} attributes only`, async () => {
      const zip = markDirectoryByAttrs(await buildBundle(), "slice.json", kind);
      expect(await refused(zip)).toMatch(/directory entry/i);
    });
  }

  it("refuses a damaged central directory", async () => {
    const zip = damageCentralDirectory(await buildBundle());
    expect(await refused(zip)).toMatch(/damaged/i);
  });

  it("refuses a name the reader would normalise", async () => {
    const zip = renameEntry(await buildBundle(), "tip.json", "./tip.js");
    expect(await refused(zip)).toMatch(/disagree/i);
  });

  it("refuses when the local-header name differs from the central-directory name", async () => {
    const zip = renameLocalOnly(await buildBundle(), "tip.json", "tap.json");
    expect(await refused(zip)).toMatch(/local header/i);
  });
});

describe("readBundle: fixed paths, BOM, WebCrypto", () => {
  it("opens a bundle whose proposal is not UTF-8, and lists it by path only", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80]);
    const files = [
      ...validFiles(),
      { path: "proposals/x.patch", role: "proposal", content: bytes },
    ];
    const r = await readBundle(await buildBundle(files));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bundle.proposals).toEqual(["proposals/x.patch"]);
    expect(r.bundle.texts.has("proposals/x.patch")).toBe(false);
  });

  it("still refuses a non-UTF-8 document the viewer reads as text", async () => {
    const files = validFiles().map((f) =>
      f.path === "evidence/trace.jsonl"
        ? { ...f, content: new Uint8Array([0xff, 0xfe, 0xfd]) }
        : f,
    );
    expect(await refused(await buildBundle(files))).toMatch(/UTF-8/);
  });

  it("refuses a role at the wrong path", async () => {
    const files = validFiles().map((f) =>
      f.path === "slice.json" ? { ...f, path: "elsewhere/slice.json" } : f,
    );
    expect(await refused(await buildBundle(files))).toMatch(
      /slice.*expected path/i,
    );
  });

  it("keeps a UTF-8 BOM so the text matches the bytes", async () => {
    const files = validFiles().map((f) =>
      f.path === "evidence/trace.jsonl"
        ? { ...f, content: "\uFEFF" + f.content }
        : f,
    );
    const r = await readBundle(await buildBundle(files));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bundle.trace?.charCodeAt(0)).toBe(0xfeff);
  });

  it("refuses with a clear message when WebCrypto is unavailable", async () => {
    const zip = await buildBundle();
    vi.stubGlobal("crypto", {});
    try {
      expect(await refused(zip)).toMatch(/HTTPS or localhost/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
