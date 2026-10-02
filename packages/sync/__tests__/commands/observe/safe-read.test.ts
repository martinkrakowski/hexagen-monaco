import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeReadText } from "../../../src/commands/observe/imports/safe-read.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-safe-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (dirs.length) {
    await fs.rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("safeReadText", () => {
  it("reads a regular file and reports its size", async () => {
    const d = await tmp();
    await fs.writeFile(path.join(d, "a.ts"), "héllo");
    expect(await safeReadText(path.join(d, "a.ts"), 100)).toEqual({
      ok: true,
      text: "héllo",
      size: 6,
    });
  });

  it("decides the size limit on the opened handle, not on a separate stat (bot 4)", async () => {
    const d = await tmp();
    await fs.writeFile(path.join(d, "a.ts"), "x"); // 1 byte on disk
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await (
        realOpen as (
          ...a: unknown[]
        ) => Promise<Awaited<ReturnType<typeof fs.open>>>
      )(...args);
      // The handle says the file is big: the path-based answer would be 1.
      handle.stat = (async () => ({ size: 50, isFile: () => true })) as never;
      return handle;
    });
    expect(await safeReadText(path.join(d, "a.ts"), 10)).toEqual({
      ok: false,
      why: "too-large",
    });
  });

  it("refuses a symlink (POSIX)", async () => {
    if (process.platform === "win32") return;
    const d = await tmp();
    await fs.writeFile(path.join(d, "real.ts"), "x");
    await fs.symlink(path.join(d, "real.ts"), path.join(d, "link.ts"));
    expect(await safeReadText(path.join(d, "link.ts"), 100)).toEqual({
      ok: false,
      why: "unreadable",
    });
  });

  it("refuses a directory and a missing file", async () => {
    const d = await tmp();
    expect(await safeReadText(d, 100)).toEqual({
      ok: false,
      why: "unreadable",
    });
    expect(await safeReadText(path.join(d, "nope"), 100)).toEqual({
      ok: false,
      why: "unreadable",
    });
  });
});
