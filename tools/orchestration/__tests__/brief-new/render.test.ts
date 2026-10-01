import { describe, expect, test } from "vitest";
import { render, type BriefHeader } from "../../src/brief-new/render.js";

/**
 * The single-pass substitution, checked on `render` itself. Through the command
 * line no `--lane`, `--plan`, `--branch` or `--tip` can hold a `<`, so only
 * `--env` lines (which are never substituted) and the host name could carry a
 * placeholder-like substring. `render` is a pure function, so it is driven with
 * such values directly: a value that reads like a placeholder must come out
 * exactly as given, and must not be replaced a second time.
 */
const HEADER: BriefHeader = {
  lane: "<BRANCH>",
  plan: "<SHA>",
  branch: "<LANE>",
  tip: "<PLAN_PATH>",
  host: "<LANE>",
  gate: "targeted-only",
  remote: false,
  env: ["E=<LANE>"],
};

describe("brief-new render — one pass", () => {
  test("a value that reads like a placeholder is written as given, never substituted again", () => {
    const brief = render(HEADER);
    expect(brief).toContain("You are lane <BRANCH> of wave <N>");
    expect(brief).toContain(
      "(branch <LANE>, based on origin/main <PLAN_PATH>)",
    );
    expect(brief).toContain("1. The plan: <SHA> — sections <SECTIONS>.");
  });

  test("the host name and the env lines are never scanned for placeholders", () => {
    const brief = render(HEADER);
    expect(brief).toContain("lane host `<LANE>`");
    expect(brief).toContain("\nE=<LANE>\n");
  });
});
