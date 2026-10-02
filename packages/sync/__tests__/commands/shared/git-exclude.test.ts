import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureExcluded,
  GitExcludeError,
  resolveExcludeFile,
} from "../../../src/commands/shared/git-exclude.js";

const dirs: string[] = [];
async function repo(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-excl-"));
  dirs.push(d);
  execFileSync("git", ["init", "-q"], { cwd: d });
  return d;
}
afterEach(async () => {
  while (dirs.length) {
    await fs.rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("git-exclude helper", () => {
  it("appends the entry once and reports whether it wrote", async () => {
    const root = await repo();
    const first = await ensureExcluded(root, ".hexagen/");
    expect(first.wrote).toBe(true);
    const second = await ensureExcluded(root, ".hexagen/");
    expect(second.wrote).toBe(false);
    const text = await fs.readFile(first.file, "utf8");
    expect(text.split("\n").filter((l) => l === ".hexagen/")).toHaveLength(1);
  });

  it("starts a new line when the file does not end in one", async () => {
    const root = await repo();
    const file = await resolveExcludeFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "keep-me");
    await ensureExcluded(root, ".hexagen/");
    expect(await fs.readFile(file, "utf8")).toBe("keep-me\n.hexagen/\n");
  });

  it.skipIf(process.platform === "win32")(
    "refuses an exclude file that is a symlink out of the repository",
    async () => {
      const root = await repo();
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-out-"));
      dirs.push(outside);
      const file = path.join(root, ".git", "info", "exclude");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.rm(file, { force: true });
      await fs.symlink(path.join(outside, "target"), file);
      await expect(ensureExcluded(root, ".hexagen/")).rejects.toBeInstanceOf(
        GitExcludeError,
      );
      await expect(fs.stat(path.join(outside, "target"))).rejects.toThrow();
    },
  );
});
