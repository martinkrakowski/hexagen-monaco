import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The skill's native-binary diagnostic is a shell snippet an orchestrator pastes after a wave's
 * installs. It is run here, for real, against throwaway trees, because a diagnostic that is only
 * read can pass vacuously: a glob that matches nothing makes the loop body never run, and the
 * snippet used to exit 0 having looked at nothing. It must fail when discovery finds nothing.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(
  HERE,
  "..",
  "..",
  "templates",
  "orchestration",
  "files",
  ".agents",
  "skills",
  "orchestrate-wave",
  "SKILL.md",
);

/** The fenced block whose body holds the `*darwin*` discovery loop, dedented. */
function diagnostic(): string {
  const lines = fs.readFileSync(SKILL, "utf8").split("\n");
  const at = lines.findIndex((line) => line.includes("for d in node_modules/"));
  expect(at, "the diagnostic loop must be in the skill").toBeGreaterThan(-1);
  let open = at;
  while (!/^\s*```/.test(lines[open] as string)) open -= 1;
  let close = at;
  while (!/^\s*```\s*$/.test(lines[close] as string)) close += 1;
  const indent = (lines[open] as string).match(/^\s*/)![0].length;
  return lines
    .slice(open + 1, close)
    .map((line) => line.slice(indent))
    .join("\n");
}

const roots: string[] = [];
function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "darwin-diag-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "node_modules"));
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

function run(root: string) {
  const result = spawnSync("sh", ["-c", diagnostic()], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("the Darwin native-package diagnostic in the skill", () => {
  it("fails when discovery finds no darwin package at all", () => {
    const { code, out } = run(tree({}));
    expect(code).not.toBe(0);
    expect(out).toContain("NOTHING DISCOVERED");
  });

  it("is silent and exits 0 when every discovered package has a payload", () => {
    const { code, out } = run(
      tree({
        "node_modules/@esbuild/darwin-arm64/bin/esbuild": "bin",
        "node_modules/@esbuild/darwin-arm64/package.json": "{}",
        "node_modules/fsevents-darwin/lib/x.js": "x",
      }),
    );
    expect(out).toBe("");
    expect(code).toBe(0);
  });

  it("names a package left with metadata only, and exits non-zero", () => {
    const { code, out } = run(
      tree({
        "node_modules/@esbuild/darwin-arm64/package.json": "{}",
        "node_modules/@esbuild/darwin-arm64/README.md": "r",
        "node_modules/@img/sharp-darwin-arm64/lib/x.js": "x",
      }),
    );
    expect(code).not.toBe(0);
    expect(out).toContain("STRIPPED: node_modules/@esbuild/darwin-arm64/");
    expect(out).not.toContain("sharp-darwin-arm64");
    expect(out).not.toContain("NOTHING DISCOVERED");
  });
});
