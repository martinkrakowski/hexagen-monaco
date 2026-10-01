import { describe, expect, test } from "vitest";
import { parseFixBriefArgs } from "../../src/fix-brief/args.js";

const base = [
  "--pr",
  "12",
  "--round",
  "2",
  "--lane",
  "L1",
  "--worktree",
  "/w/l1",
  "--branch",
  "feat/x",
  "--tip",
  "abc1234",
];

describe("fix-brief arguments", () => {
  test("a complete command line parses, and --out is optional", () => {
    expect(parseFixBriefArgs(base)).toEqual({
      pr: 12,
      round: 2,
      lane: "L1",
      worktree: "/w/l1",
      branch: "feat/x",
      tip: "abc1234",
    });
    expect(parseFixBriefArgs([...base, "--out", "b.md"]).out).toBe("b.md");
  });

  test.each(["--pr", "--round"])(
    "%s must be a positive safe integer",
    (flag) => {
      const swap = (value: string): string[] =>
        base.map((a, i) => (base[i - 1] === flag ? value : a));
      for (const bad of [
        "0",
        "-1",
        "1.5",
        "abc",
        "",
        "9007199254740993",
        "9".repeat(400),
      ]) {
        expect(() => parseFixBriefArgs(swap(bad)), bad).toThrow(flag);
      }
      expect(parseFixBriefArgs(swap("9007199254740991"))).toBeDefined();
    },
  );

  test.each(["--lane", "--worktree", "--branch", "--tip"])(
    "%s must be a single line: any control or line-separator character is refused",
    (flag) => {
      const swap = (value: string): string[] =>
        base.map((a, i) => (base[i - 1] === flag ? value : a));
      for (const bad of ["a\nb", "a\rb", "a\u0000b", "a b", "a b"]) {
        expect(() => parseFixBriefArgs(swap(bad)), JSON.stringify(bad)).toThrow(
          /single line/,
        );
      }
      expect(parseFixBriefArgs(swap("fine value"))).toBeDefined();
    },
  );

  test("every header flag is required, and a flag given twice is refused", () => {
    for (const flag of [
      "--pr",
      "--round",
      "--lane",
      "--worktree",
      "--branch",
      "--tip",
    ]) {
      const at = base.indexOf(flag);
      const without = [...base.slice(0, at), ...base.slice(at + 2)];
      expect(() => parseFixBriefArgs(without), flag).toThrow(
        `a ${flag} is required`,
      );
    }
    expect(() => parseFixBriefArgs([...base, "--pr", "13"])).toThrow(
      /given twice/,
    );
  });

  test("an unknown argument and a flag starved of its value are refused", () => {
    expect(() => parseFixBriefArgs([...base, "--nope"])).toThrow(
      /unknown argument/,
    );
    expect(() => parseFixBriefArgs([...base, "--out"])).toThrow(
      /missing value for --out/,
    );
    expect(() => parseFixBriefArgs([...base, "--out", "--pr"])).toThrow(
      /missing value for --out/,
    );
  });
});
