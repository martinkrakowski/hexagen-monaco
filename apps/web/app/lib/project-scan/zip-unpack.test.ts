import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  DuplicateZipEntryError,
  EmptyZipError,
  InvalidZipError,
  ZipResourceLimitError,
  ZipSlipError,
  assertSafeZipEntry,
  isUnsafeZipEntry,
  unpackZipToDir,
} from "./zip-unpack";

async function zipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

describe("isUnsafeZipEntry / zip-slip", () => {
  const dest = "/tmp/hexagen-scan-dest";

  it("rejects parent-directory segments", () => {
    assert.equal(isUnsafeZipEntry(dest, "../etc/passwd"), true);
    assert.equal(isUnsafeZipEntry(dest, "foo/../../etc/passwd"), true);
    assert.equal(isUnsafeZipEntry(dest, "..\\windows\\system32"), true);
  });

  it("rejects absolute POSIX, Windows, and UNC paths", () => {
    assert.equal(isUnsafeZipEntry(dest, "/etc/passwd"), true);
    assert.equal(isUnsafeZipEntry(dest, "C:\\Windows\\system.ini"), true);
    assert.equal(isUnsafeZipEntry(dest, "\\\\server\\share\\x"), true);
  });

  it("rejects NUL bytes", () => {
    assert.equal(isUnsafeZipEntry(dest, "ok.txt\0../evil"), true);
  });

  it("allows nested relative files", () => {
    assert.equal(isUnsafeZipEntry(dest, "packages/foo/src/index.ts"), false);
    assert.equal(isUnsafeZipEntry(dest, "package.json"), false);
  });

  it("assertSafeZipEntry throws ZipSlipError", () => {
    assert.throws(() => assertSafeZipEntry(dest, "../x"), ZipSlipError);
  });
});

describe("unpackZipToDir", () => {
  it("writes a safe archive under destRoot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-unpack-"));
    try {
      const buf = await zipBuffer({
        "package.json": '{"name":"demo"}',
        "src/index.ts": "export {}",
      });
      const { filesWritten } = await unpackZipToDir(buf, dir);
      assert.equal(filesWritten, 2);
      assert.equal(
        await readFile(path.join(dir, "package.json"), "utf8"),
        '{"name":"demo"}',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a zip-slip entry before writing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-slip-"));
    try {
      const buf = await zipBuffer({
        "package.json": "{}",
        "../outside.txt": "escaped",
      });
      await assert.rejects(() => unpackZipToDir(buf, dir), ZipSlipError);
      await assert.rejects(() => readFile(path.join(dir, "package.json")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an empty zip", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-empty-"));
    try {
      const buf = await zipBuffer({});
      await assert.rejects(() => unpackZipToDir(buf, dir), EmptyZipError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a buffer that is not a zip", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-invalid-"));
    try {
      await assert.rejects(
        () => unpackZipToDir(Buffer.from("not a zip"), dir),
        InvalidZipError,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  const tight = {
    maxEntries: 2,
    maxEntryBytes: 16,
    maxUncompressedBytes: 24,
  } as const;

  it("rejects when entry count exceeds the limit before writing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-entries-"));
    try {
      const buf = await zipBuffer({ a: "1", b: "2", c: "3" });
      await assert.rejects(
        () => unpackZipToDir(buf, dir, tight),
        ZipResourceLimitError,
      );
      await assert.rejects(() => readFile(path.join(dir, "a")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when a single entry exceeds the per-file uncompressed limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-entry-"));
    try {
      const buf = await zipBuffer({ "big.txt": "x".repeat(32) });
      await assert.rejects(
        () => unpackZipToDir(buf, dir, tight),
        (err: unknown) =>
          err instanceof ZipResourceLimitError && err.limit === "entry-bytes",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when aggregate uncompressed size exceeds the limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-agg-"));
    try {
      const buf = await zipBuffer({
        a: "xxxxxxxxxxxxxxxx",
        b: "yyyyyyyyyyyyyyyy",
      });
      await assert.rejects(
        () => unpackZipToDir(buf, dir, tight),
        (err: unknown) =>
          err instanceof ZipResourceLimitError &&
          err.limit === "uncompressed-bytes",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate normalized entry names without writing any files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-dup-"));
    try {
      const zip = new JSZip();
      zip.file("a.txt", "first");
      zip.file("a.txt/", "second"); // directory entry with same normalized name
      const buf = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
      const limits = { ...tight, maxEntries: 10 };
      await assert.rejects(
        () => unpackZipToDir(buf, dir, limits),
        (err: unknown) => err instanceof DuplicateZipEntryError,
      );
      await assert.rejects(() => readFile(path.join(dir, "a.txt")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("aborts an inflation bomb mid-stream instead of buffering it whole", async () => {
    // This asserts the STREAMING guarantee, not merely that an oversized entry
    // is rejected. Asserting only that the call throws would pass against the
    // previous post-inflation implementation too -- it threw the identical
    // error, just after materialising the entire entry in memory. The
    // distinguishing evidence is how many bytes were read before the abort.
    const dir = await mkdtemp(path.join(tmpdir(), "hexagen-scan-bomb-"));
    try {
      const maxEntryBytes = 1024; // 1 KiB cap
      const inflatedSize = 5 * 1024 * 1024; // 5 MiB of highly compressible data
      const limits = { ...tight, maxEntryBytes };
      const zip = new JSZip();
      zip.file("bomb.txt", "x".repeat(inflatedSize));
      const buf = Buffer.from(await zip.generateAsync({ type: "uint8array" }));

      let caught: ZipResourceLimitError | undefined;
      await assert.rejects(
        () => unpackZipToDir(buf, dir, limits),
        (err: unknown) => {
          assert.ok(err instanceof ZipResourceLimitError);
          assert.equal(err.limit, "entry-bytes");
          caught = err;
          return true;
        },
      );

      // The abort must happen after the cap is crossed but long before the full
      // 5 MiB is read. A generous 1 MiB ceiling keeps this robust to whatever
      // chunk size the zip stream happens to use, while still being ~5x below
      // the payload -- so a regression to full buffering fails loudly.
      assert.ok(
        caught?.bytesRead !== undefined,
        "bytesRead must be reported so the streaming guarantee is observable",
      );
      assert.ok(
        caught.bytesRead > maxEntryBytes,
        "abort should trigger only after the cap is crossed",
      );
      assert.ok(
        caught.bytesRead < 1024 * 1024,
        `expected an early abort, but ${caught.bytesRead} bytes were read of ${inflatedSize}`,
      );

      // Nothing may reach disk.
      await assert.rejects(() => readFile(path.join(dir, "bomb.txt")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
