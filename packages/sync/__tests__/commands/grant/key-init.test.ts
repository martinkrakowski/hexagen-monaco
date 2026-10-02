import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { grantKeyInitCommand } from "../../../src/commands/grant/key-init.js";

const dirs: string[] = [];
let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  process.exitCode = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});
async function home(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "key-init-"));
  dirs.push(d);
  return d;
}

const posix = process.platform !== "win32";

describe("grant key init", () => {
  it("writes 32 random bytes as hex, prints path and fingerprint, never the key", async () => {
    const h = await home();
    await grantKeyInitCommand({ engagement: "eng-1", homeDir: h });
    expect(process.exitCode).toBe(0);
    const keyPath = path.join(h, ".hexagen", "keys", "eng-1.key");
    const hex = (await readFile(keyPath, "utf-8")).trim();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    const text = out.join("\n");
    expect(text).toContain(keyPath);
    expect(text).toMatch(/fingerprint [0-9a-f]{16}/);
    expect(text).not.toContain(hex);
    if (posix) {
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(path.dirname(keyPath))).mode & 0o777).toBe(0o700);
    }
  });

  it("refuses to overwrite an existing key (exit 1) and leaves it intact", async () => {
    const h = await home();
    await grantKeyInitCommand({ engagement: "eng-1", homeDir: h });
    const keyPath = path.join(h, ".hexagen", "keys", "eng-1.key");
    const before = await readFile(keyPath, "utf-8");
    out.length = 0;
    await grantKeyInitCommand({ engagement: "eng-1", homeDir: h });
    expect(process.exitCode).toBe(1);
    expect(await readFile(keyPath, "utf-8")).toBe(before);
    expect(out.join("\n")).toContain(keyPath);
    expect(out.join("\n")).not.toContain(before.trim());
  });

  it("refuses engagement ids with .. or /", async () => {
    const h = await home();
    for (const id of ["../x", "a/b", "..", "a..b", "", "a b"]) {
      process.exitCode = 0;
      await grantKeyInitCommand({ engagement: id, homeDir: h });
      expect(process.exitCode).toBe(1);
    }
  });

  it("honours --key-file", async () => {
    const h = await home();
    const target = path.join(h, "custom", "my.key");
    await grantKeyInitCommand({
      engagement: "eng-2",
      keyFile: target,
      homeDir: h,
    });
    expect(process.exitCode).toBe(0);
    expect((await readFile(target, "utf-8")).trim()).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(target, "x"); // exists now
    process.exitCode = 0;
    await grantKeyInitCommand({
      engagement: "eng-2",
      keyFile: target,
      homeDir: h,
    });
    expect(process.exitCode).toBe(1);
  });
});
