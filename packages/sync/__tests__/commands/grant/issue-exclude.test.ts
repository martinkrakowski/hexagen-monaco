import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { issueGrantCommand } from "../../../src/commands/grant/issue.js";
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
    const d = dirs.pop() as string;
    await chmod(path.join(d, ".git", "info"), 0o755).catch(() => {});
    await rm(d, { recursive: true, force: true });
  }
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function setup(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "bf-excl-root-"));
  const home = await mkdtemp(path.join(tmpdir(), "bf-excl-home-"));
  dirs.push(root, home);
  git(root, "init", "-q");
  await mkdir(path.join(root, ".hexagen"), { recursive: true });
  await writeFile(
    path.join(root, ".hexagen", "slice.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "eng-x",
      repo: { commit: "0123456789abcdef" },
      paths: ["src/"],
      excludes: [],
      createdBy: "t",
      createdAt: "2026-10-01T00:00:00Z",
    }),
  );
  await grantKeyInitCommand({ engagement: "eng-x", homeDir: home });
  out.length = 0;
  return { root, home };
}

const opts = (root: string, home: string, extra = {}) => ({
  principal: "m",
  agent: "a",
  tools: "write_file",
  mode: "write" as const,
  expiresIn: "1h",
  workspaceRoot: root,
  homeDir: home,
  out: ".hexagen/grants/g1.json",
  ...extra,
});

describe("brownfield grant issue: git exclude", () => {
  it("adds .hexagen/ to the exclude file once, and the grant is then ignored", async () => {
    const { root, home } = await setup();
    await issueGrantCommand(opts(root, home, { yes: true }));
    expect(process.exitCode).toBe(0);
    const exclude = path.resolve(
      root,
      git(root, "rev-parse", "--git-path", "info/exclude"),
    );
    expect(await readFile(exclude, "utf-8")).toContain(".hexagen/\n");
    expect(() =>
      git(root, "check-ignore", "-q", ".hexagen/grants/g1.json"),
    ).not.toThrow();
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);

    await issueGrantCommand(
      opts(root, home, { yes: true, out: ".hexagen/grants/g2.json" }),
    );
    expect(process.exitCode).toBe(0);
    const lines = (await readFile(exclude, "utf-8"))
      .split("\n")
      .filter((l) => l.trim() === ".hexagen/");
    expect(lines).toHaveLength(1);
  });

  it("without --yes prints the preflight, exits 2, and writes nothing", async () => {
    const { root, home } = await setup();
    const exclude = path.resolve(
      root,
      git(root, "rev-parse", "--git-path", "info/exclude"),
    );
    const before = await readFile(exclude, "utf-8").catch(() => null);
    await issueGrantCommand(opts(root, home));
    expect(process.exitCode).toBe(2);
    const text = out.join("\n");
    expect(text).toContain("preflight");
    expect(text).toContain(path.join(root, ".hexagen/grants/g1.json"));
    expect(text).toContain(exclude);
    expect(existsSync(path.join(root, ".hexagen", "grants"))).toBe(false);
    expect(await readFile(exclude, "utf-8").catch(() => null)).toBe(before);
  });

  it("omits the exclude file from the preflight when it already covers .hexagen/", async () => {
    const { root, home } = await setup();
    await issueGrantCommand(opts(root, home, { yes: true }));
    out.length = 0;
    process.exitCode = 0;
    await issueGrantCommand(
      opts(root, home, { out: ".hexagen/grants/g3.json" }),
    );
    expect(process.exitCode).toBe(2);
    expect(out.join("\n")).not.toContain("exclude file");
  });

  it("in a linked worktree (.git is a file) writes the common dir's exclude", async () => {
    const { root, home } = await setup();
    git(
      root,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "i",
    );
    const wt = path.join(
      await mkdtemp(path.join(tmpdir(), "bf-excl-wt-")),
      "wt",
    );
    dirs.push(path.dirname(wt));
    git(root, "worktree", "add", "-q", wt, "-b", "side");
    await mkdir(path.join(wt, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(wt, ".hexagen", "slice.json"),
      await readFile(path.join(root, ".hexagen", "slice.json")),
    );
    expect(
      (await readFile(path.join(wt, ".git"), "utf-8")).startsWith("gitdir:"),
    ).toBe(true);
    await issueGrantCommand(opts(wt, home, { yes: true }));
    expect(process.exitCode).toBe(0);
    const exclude = path.resolve(
      wt,
      git(wt, "rev-parse", "--git-path", "info/exclude"),
    );
    expect(
      exclude.startsWith(
        path.join(
          await (await import("node:fs/promises")).realpath(root),
          ".git",
        ),
      ),
    ).toBe(true);
    expect(await readFile(exclude, "utf-8")).toContain(".hexagen/\n");
    expect(() =>
      git(wt, "check-ignore", "-q", ".hexagen/grants/g1.json"),
    ).not.toThrow();
  });

  it("an exclude failure exits 2 and writes no grant", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const { root, home } = await setup();
    const file = path.join(root, ".git", "info", "exclude");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "# none\n");
    await chmod(file, 0o400);
    await issueGrantCommand(opts(root, home, { yes: true }));
    expect(process.exitCode).toBe(2);
    expect(existsSync(path.join(root, ".hexagen", "grants"))).toBe(false);
  });
});
