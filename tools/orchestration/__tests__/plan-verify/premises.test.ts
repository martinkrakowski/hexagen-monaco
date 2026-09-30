import { describe, expect, test } from "vitest";
import { parsePremises } from "../../src/plan-verify/lib/premises.js";

describe("parsePremises", () => {
  test("reads the lane id and the script out of a premise fence", () => {
    const md = [
      "# Plan",
      "",
      "```premise W4",
      "grep -q foo bar.ts",
      "```",
      "",
    ].join("\n");
    expect(parsePremises("docs/planning/p.md", md)).toEqual([
      { plan: "docs/planning/p.md", lane: "W4", script: "grep -q foo bar.ts" },
    ]);
  });

  test("reads every premise in a document, in order", () => {
    const md = [
      "```premise A",
      "one",
      "```",
      "prose between",
      "```premise B",
      "two",
      "```",
    ].join("\n");
    expect(parsePremises("p.md", md).map((p) => p.lane)).toEqual(["A", "B"]);
  });

  test("keeps a multi-line script intact", () => {
    const md = ["```premise K1", "set -e", "grep -q a f.ts", "```"].join("\n");
    expect(parsePremises("p.md", md)[0]?.script).toBe("set -e\ngrep -q a f.ts");
  });

  test("ignores a plain fence, and a fence with no lane id", () => {
    const md = [
      "```sh",
      "grep -q foo bar.ts",
      "```",
      "```premise",
      "x",
      "```",
    ].join("\n");
    expect(parsePremises("p.md", md)).toEqual([]);
  });

  test("an empty premise is an error naming the plan and the lane", () => {
    const md = ["```premise W9", "   ", "```"].join("\n");
    expect(() => parsePremises("docs/planning/p.md", md)).toThrow(
      /EMPTY\s+W9\s+\(docs\/planning\/p\.md\)/,
    );
    expect(() => parsePremises("docs/planning/p.md", md)).toThrow(
      /hides the lane/,
    );
  });

  test("an unclosed premise fence is an error naming the plan and the lane", () => {
    const md = "```premise W1\ntrue\n";
    expect(() => parsePremises("p.md", md)).toThrow(
      /UNCLOSED\s+W1\s+\(p\.md\)/,
    );
    expect(() => parsePremises("p.md", md)).toThrow(/never closed/);
  });

  test("the second of two fences, when left unclosed, is the one named", () => {
    const md = [
      "```premise A",
      "true",
      "```",
      "",
      "```premise B",
      "false",
      "",
    ].join("\n");
    expect(() => parsePremises("p.md", md)).toThrow(/UNCLOSED\s+B\s+\(p\.md\)/);
  });

  test("an id-less fence with no close is still ignored, not counted as an opening", () => {
    const md = ["```premise", "x", "prose that never closes"].join("\n");
    expect(parsePremises("p.md", md)).toEqual([]);
  });

  test("an opener-shaped line inside a closed premise body is not an opening", () => {
    const md = [
      "```premise A",
      "cat <<'EOF'",
      "```premise B",
      "quoted from another plan",
      "EOF",
      "true",
      "```",
    ].join("\n");
    expect(parsePremises("p.md", md)).toEqual([
      {
        plan: "p.md",
        lane: "A",
        script: [
          "cat <<'EOF'",
          "```premise B",
          "quoted from another plan",
          "EOF",
          "true",
        ].join("\n"),
      },
    ]);
  });

  test("an opener with trailing text is an unclosed-or-malformed error naming the lane", () => {
    const md = ["```premise A some comment", "true", "```"].join("\n");
    expect(() => parsePremises("p.md", md)).toThrow(/A/);
    expect(() => parsePremises("p.md", md)).toThrow(/unclosed/i);
    expect(() => parsePremises("p.md", md)).toThrow(/malformed/i);
    expect(() => parsePremises("p.md", md)).toThrow(/alone on its line/);
  });

  test("is re-entrant: the shared global regex cannot skip a document", () => {
    const md = ["```premise W1", "true", "```"].join("\n");
    expect(parsePremises("a.md", md)).toHaveLength(1);
    expect(parsePremises("b.md", md)).toHaveLength(1);
  });
});
