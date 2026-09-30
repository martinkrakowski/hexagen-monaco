import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * hexagen-monaco tracks its own copy of the orchestrate-wave skill (OW6, B1) at
 * `.agents/skills/orchestrate-wave/`. It is the template's `files/` copy, byte for byte, and a
 * hand edit of either side must fail here rather than drift.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SKILL = path.join(".agents", "skills", "orchestrate-wave");
const TEMPLATE_SIDE = path.join(
  REPO_ROOT,
  "packages",
  "template-engine",
  "templates",
  "orchestration",
  "files",
  SKILL,
);
const MIRROR_SIDE = path.join(REPO_ROOT, SKILL);

function walk(root: string, dir = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (entry.name === ".DS_Store") continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(root, relative));
    else out.push(relative);
  }
  return out.sort();
}

describe("the tracked skill mirror", () => {
  it("has the same files as the template copy, none missing and none extra", () => {
    expect(walk(MIRROR_SIDE)).toEqual(walk(TEMPLATE_SIDE));
    expect(walk(TEMPLATE_SIDE).length).toBeGreaterThan(0);
  });

  it("has the same bytes in every file", () => {
    for (const relative of walk(TEMPLATE_SIDE)) {
      const mirror = fs.readFileSync(path.join(MIRROR_SIDE, relative));
      const template = fs.readFileSync(path.join(TEMPLATE_SIDE, relative));
      expect(
        mirror.equals(template),
        `${relative} differs from the template copy`,
      ).toBe(true);
    }
  });

  it("has the same executable bit on every file", () => {
    for (const relative of walk(TEMPLATE_SIDE)) {
      const mirror = fs.statSync(path.join(MIRROR_SIDE, relative)).mode & 0o111;
      const template =
        fs.statSync(path.join(TEMPLATE_SIDE, relative)).mode & 0o111;
      expect(
        mirror,
        `${relative} has a different executable bit than the template copy`,
      ).toBe(template);
    }
  });

  it("is tracked, not ignored: git check-ignore exits 1", () => {
    // --no-index: without it git skips tracked files, so exit 1 would hold even if an ignore rule matched.
    // execFileSync throws on a non-zero exit; exit 1 means "not ignored", any other status is wrong.
    let status = 0;
    try {
      execFileSync(
        "git",
        ["check-ignore", "--no-index", "--quiet", path.join(SKILL, "SKILL.md")],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    } catch (error) {
      status = (error as { status: number }).status;
    }
    expect(status).toBe(1);
  });

  it("is in the git index, file for file", () => {
    const tracked = execFileSync("git", ["ls-files", "--", SKILL], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map((p) => path.relative(SKILL, p))
      .sort();
    expect(tracked).toEqual(walk(TEMPLATE_SIDE));
  });
});
