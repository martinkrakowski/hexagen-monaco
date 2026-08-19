import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  EmptyZipError,
  InvalidZipError,
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
});
