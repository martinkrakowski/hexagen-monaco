import { describe, expect, test } from "vitest";
import { parseBriefNewArgs } from "../../src/brief-new/args.js";

const GOOD = [
  "--lane",
  "PB6",
  "--plan",
  "docs/planning/plan.md",
  "--branch",
  "feat/x",
  "--tip",
  "abc1234",
  "--host",
  "midnight",
];

/** GOOD with one flag's value swapped. */
function with_(flag: string, value: string): string[] {
  const out = [...GOOD];
  out[out.indexOf(flag) + 1] = value;
  return out;
}

describe("brief-new arguments", () => {
  test("a complete command line parses, --env repeats in order, --out is optional", () => {
    expect(parseBriefNewArgs(GOOD)).toEqual({
      lane: "PB6",
      plan: "docs/planning/plan.md",
      branch: "feat/x",
      tip: "abc1234",
      host: "midnight",
      env: [],
    });
    const parsed = parseBriefNewArgs([
      ...GOOD,
      "--env",
      "A=1",
      "--env",
      "B=x y=z",
      "--out",
      "d/e/brief.md",
    ]);
    expect(parsed.env).toEqual(["A=1", "B=x y=z"]);
    expect(parsed.out).toBe("d/e/brief.md");
  });

  test.each([
    ["--lane", "a b"],
    ["--lane", "a/b"],
    ["--lane", "a.b"],
    ["--plan", "a b"],
    ["--plan", "a:b"],
    ["--branch", "a b"],
    ["--branch", "a~b"],
    ["--tip", "abc123"],
    ["--tip", "ABC1234"],
    ["--tip", "g".repeat(7)],
    ["--tip", "a".repeat(41)],
  ])("%s %j is refused, and the message names the flag", (flag, value) => {
    expect(() => parseBriefNewArgs(with_(flag, value))).toThrow(
      new RegExp(`^${flag} must be`),
    );
  });

  test.each(["\n", "\r", " ", " ", "‮", "​", "\u0007"])(
    "a header value carrying the character %j is refused as not one line",
    (bad) => {
      for (const flag of ["--lane", "--plan", "--branch", "--tip", "--host"]) {
        const value = flag === "--tip" ? `abc1234${bad}` : `ok${bad}x`;
        expect(() => parseBriefNewArgs(with_(flag, value))).toThrow(
          new RegExp(`^${flag} must be a single line`),
        );
      }
      expect(() => parseBriefNewArgs([...GOOD, "--env", `A=1${bad}x`])).toThrow(
        /^--env must be a single line/,
      );
    },
  );

  test.each(["\n", "\r", "\u2028", "\u2029", "\u202e", "\u200b", "\u001b"])(
    "an --out carrying the character %j is refused, so the summary line cannot be forged",
    (bad) => {
      expect(() =>
        parseBriefNewArgs([...GOOD, "--out", `d/b${bad}x.md`]),
      ).toThrow(/^--out must be a single line/);
    },
  );

  test("an --out with spaces or unusual printable characters is still a path", () => {
    expect(parseBriefNewArgs([...GOOD, "--out", "my dir/b (1).md"]).out).toBe(
      "my dir/b (1).md",
    );
  });

  test("an --env that is not KEY=VALUE is refused, naming the flag", () => {
    for (const bad of ["NOEQUALS", "=v", "1A=v", "A B=v"]) {
      expect(() => parseBriefNewArgs([...GOOD, "--env", bad])).toThrow(
        /^--env must be KEY=VALUE/,
      );
    }
    expect(parseBriefNewArgs([...GOOD, "--env", "A="]).env).toEqual(["A="]);
  });

  test("a missing, duplicated, empty or unknown argument is refused", () => {
    expect(() => parseBriefNewArgs(GOOD.slice(2))).toThrow(
      /a --lane is required/,
    );
    expect(() => parseBriefNewArgs(GOOD.slice(0, -2))).toThrow(
      /a --host is required/,
    );
    expect(() => parseBriefNewArgs([...GOOD, "--lane", "X"])).toThrow(
      /--lane is given twice/,
    );
    expect(() => parseBriefNewArgs([...GOOD, "--out"])).toThrow(
      /missing value for --out/,
    );
    expect(() => parseBriefNewArgs(with_("--host", " "))).toThrow(
      /--host was given an empty value/,
    );
    expect(() => parseBriefNewArgs([...GOOD, "--nope"])).toThrow(
      /unknown argument '--nope'/,
    );
  });
});
