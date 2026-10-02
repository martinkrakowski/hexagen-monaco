import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The orchestrate-wave skill's process rules from the parity plan (P-D3, P-D4, P-D5, P-D6), pinned
 * by the words that carry each rule so a reword that drops one fails here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(
  HERE,
  "..",
  "..",
  "templates",
  "orchestration",
  "files",
  ".agents",
  "skills",
  "orchestrate-wave",
);
const flat = (file: string): string =>
  fs.readFileSync(path.join(SKILL_DIR, file), "utf8").replace(/\s+/g, " ");

const skill = flat("SKILL.md");
const briefs = flat(path.join("references", "briefs.md"));

describe("process rules in the orchestrate-wave skill", () => {
  it("P-D3: review tiering is keyed to the plan row's risk column", () => {
    expect(skill).toContain("follows the plan row's risk column");
    expect(skill).toContain(
      "A normal-risk lane gets ONE combined reviewer pass covering the plan row, the brief and the implementation diff together",
    );
    expect(skill).toContain(
      "A high-risk lane keeps separate row, brief and pre-PR reviews",
    );
    expect(skill).toContain("review bots stay on every PR");
  });

  it("P-D4: a lane's result is verified on a second host, CI for a local one", () => {
    expect(skill).toContain(
      "verified on a host other than the one it ran on before it is merged",
    );
    expect(skill).toContain("the second host is yours");
    expect(skill).toContain("CI is the second host");
    expect(skill).toContain("before the PR opens");
    expect(skill).not.toContain("before its PR opens");
  });

  it("P-D6: fix rounds resume, fork on a moved branch, and stagger forks", () => {
    expect(skill).toContain(
      "resumes the lane's own session when the dispatch transport supports it, and forks it when the branch has moved",
    );
    expect(skill).toContain("run -s <sessionID>");
    expect(skill).toContain("--fork");
    expect(skill).toContain("Stagger forked resumes by about 20 s");
    expect(skill).toContain("database is locked");
  });

  it("P-D6: the opencode flags are never in a lane brief template", () => {
    expect(briefs).not.toContain("--fork");
    expect(briefs).not.toContain("run -s");
  });

  it("P-D5: installProbes semantics are stated for the orchestrator", () => {
    expect(skill).toContain("installProbes");
    expect(skill).toContain("ssh <alias> -- <check>");
    expect(skill).toContain("run its `repair` ONCE");
    expect(skill).toContain("do not dispatch that worktree");
    expect(skill).toContain("both exit codes");
    expect(skill).toContain("never a `repair`");
  });

  it("the byte-scan sentence no longer claims the scaffold carries the step", () => {
    expect(skill).not.toContain(
      "byte-level scan is in the step list deliberately",
    );
    expect(skill).toContain("The scaffolded config does not add one");
  });
});
