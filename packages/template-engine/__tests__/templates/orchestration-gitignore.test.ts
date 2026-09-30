import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const TEMPLATE_SKILL =
  "packages/template-engine/templates/orchestration/files/.agents/skills/orchestrate-wave/SKILL.md";
const ROOT_SKILL = ".agents/skills/orchestrate-wave/SKILL.md";
const VERCEL_SKILL = ".agents/skills/vercel-composition-patterns/SKILL.md";

/**
 * `git check-ignore -v` prints the deciding pattern for an IGNORED path and
 * exits 0; an un-ignored path prints nothing and exits 1.
 *
 * `--no-index` is load-bearing, not belt-and-braces: without it git consults
 * the index, and a TRACKED file is exempt from the ignore rules whatever
 * `.gitignore` says. Both `orchestrate-wave` files are tracked the moment this
 * lane commits them, so a plain `git check-ignore` would report "not ignored"
 * with all four lines reverted — the guard would pass against a broken
 * `.gitignore` forever. `--no-index` asks the question about the PATTERN, which
 * is the thing this file is a guard on.
 */
function checkIgnore(relPath: string): { status: number; out: string } {
  const result = spawnSync(
    "git",
    ["check-ignore", "-v", "--no-index", relPath],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("the orchestration skill paths are tracked, and nothing else is un-ignored", () => {
  it("the template's skill path exits 1 — un-ignored (plan OW-D8, §12 A-2)", () => {
    const result = checkIgnore(TEMPLATE_SKILL);
    assert.equal(result.status, 1, `expected un-ignored, got:\n${result.out}`);
  });

  it("the root skill path exits 1 — un-ignored", () => {
    const result = checkIgnore(ROOT_SKILL);
    assert.equal(result.status, 1, `expected un-ignored, got:\n${result.out}`);
  });

  it("the fetched vercel-skill cache stays ignored, by `.agents/skills/*`", () => {
    // The blast radius of the negation is exactly one directory. The fetched
    // skills the owner pulled with Claude Code are regenerable and must stay
    // ignored — that is why the edit negates a path, not the whole rule.
    const result = checkIgnore(VERCEL_SKILL);
    assert.equal(result.status, 0, `expected ignored, got:\n${result.out}`);
    assert.match(result.out, /^\.gitignore:92:.*\.agents\/skills\/\*/m);
  });

  it("root `skills/` and another template's `skills/` still report line 90", () => {
    // The unanchored `skills/` rule is what caused this: it matches any
    // directory named `skills`, at any depth, in any template. The negation is
    // scoped to one path, so both of these are unchanged.
    for (const rel of [
      "skills/x",
      "packages/template-engine/templates/other/files/skills/x",
    ]) {
      const result = checkIgnore(rel);
      assert.equal(result.status, 0, `expected ignored, got:\n${result.out}`);
      // The deciding PATTERN is the bare, unanchored `skills/` at line 90 — not
      // a later `.agents/skills/*`-shaped rule.
      assert.match(result.out, /^\.gitignore:90:skills\/\t/m);
    }
  });

  it("the edit is exactly the four approved lines, in order", () => {
    // gitignore negation is last-match-wins, so the four lines only win while
    // nothing after them re-ignores the paths. They are read from the working
    // tree's own diff, so a future `yarn sync --force-root` that drops or
    // reorders them fails here rather than in CI on a missing skill.
    const diff = spawnSync("git", ["diff", "--", ".gitignore"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(diff.status, 0, diff.stderr);
    const added = diff.stdout
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    assert.deepStrictEqual(
      added,
      [
        "!.agents/skills/",
        ".agents/skills/*",
        "!.agents/skills/orchestrate-wave/",
        "!/packages/template-engine/templates/orchestration/files/.agents/skills/",
      ],
      "the edit is exactly the four approved lines, in order",
    );
  });
});
