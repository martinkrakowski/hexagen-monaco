import { describe, expect, test } from "vitest";
import {
  APPEND_ONLY_USAGE,
  ATTRIBUTE_USAGE,
  CHECKS_USAGE,
  CONFIG_USAGE,
  GATE_USAGE,
  KEEP_BOTH_USAGE,
  SWEEP_USAGE,
  parseAppendOnlyArgs,
  parseAttributeArgs,
  parseChecksArgs,
  parseConfigArgs,
  parseGateArgs,
  parseKeepBothArgs,
  parseSweepArgs,
} from "../../src/sweep/lib/args.js";

/**
 * The argument parsers, one per command.
 *
 * Ported from the source suite. Every usage line now names the bin this
 * package ships, and the four commands `bin/merge-prs` calls are covered here
 * too — a parser with no test is a parser whose usage text nobody reads.
 */

const argv = (extra: readonly string[] = []): string[] => [
  "--pr",
  "361",
  "--thread",
  "PRRT_kwDOT361",
  "--body",
  "the class text",
  ...extra,
];

describe("parseSweepArgs", () => {
  test("the happy path: pr, one thread, inline body, no --post", () => {
    expect(parseSweepArgs(argv())).toEqual({
      pr: 361,
      threadIds: ["PRRT_kwDOT361"],
      body: { text: "the class text" },
      post: false,
    });
  });

  test("collects every --thread, in order", () => {
    const parsed = parseSweepArgs([
      "--pr",
      "9",
      "--thread",
      "PRRT_a",
      "--thread",
      "PRRT_b",
      "--thread",
      "PRRT_c",
      "--body",
      "x",
    ]);
    expect(parsed.threadIds).toEqual(["PRRT_a", "PRRT_b", "PRRT_c"]);
  });

  test("--post flips the sign-off flag", () => {
    expect(parseSweepArgs([...argv(), "--post"]).post).toBe(true);
  });

  test("--body-file carries a path, not text", () => {
    expect(
      parseSweepArgs(["--pr", "9", "--thread", "PRRT_a", "--body-file", "d.md"])
        .body,
    ).toEqual({
      file: "d.md",
    });
  });

  test("both body sources are refused", () => {
    expect(() =>
      parseSweepArgs([
        "--pr",
        "9",
        "--thread",
        "a",
        "--body",
        "x",
        "--body-file",
        "y",
      ]),
    ).toThrow(/mutually exclusive/);
  });

  test("no body at all is refused", () => {
    expect(() => parseSweepArgs(["--pr", "9", "--thread", "a"])).toThrow(
      /body is required/,
    );
  });

  test("a missing --pr is refused", () => {
    expect(() => parseSweepArgs(["--thread", "a", "--body", "x"])).toThrow(
      /--pr is required/,
    );
  });

  test("a non-numeric --pr is refused", () => {
    expect(() =>
      parseSweepArgs(["--pr", "abc", "--thread", "a", "--body", "x"]),
    ).toThrow(/wants a number/);
  });

  test("no --thread is refused — a class of zero resolves nothing", () => {
    expect(() => parseSweepArgs(["--pr", "9", "--body", "x"])).toThrow(
      /at least one --thread/,
    );
  });

  test("an option starved of its value is refused", () => {
    for (const flag of ["--pr", "--thread", "--body", "--body-file"]) {
      expect(() => parseSweepArgs([flag])).toThrow(
        new RegExp(`missing value for ${flag}`),
      );
    }
  });

  test("an option followed by another flag is a missing-value error, not consumed as a value", () => {
    expect(() => parseSweepArgs(["--pr", "--thread", "PRRT_a"])).toThrow(
      /missing value for --pr/,
    );
    expect(() =>
      parseSweepArgs(["--pr", "123", "--thread", "--body", "x"]),
    ).toThrow(/missing value for --thread/);
  });

  test("an empty or whitespace-only --body is refused", () => {
    expect(() =>
      parseSweepArgs(["--pr", "9", "--thread", "a", "--body", ""]),
    ).toThrow(/body must not be blank/);
    expect(() =>
      parseSweepArgs(["--pr", "9", "--thread", "a", "--body", "   \t\n"]),
    ).toThrow(/body must not be blank/);
  });

  test("an unknown argument is refused, with the usage line", () => {
    const message = (() => {
      try {
        parseSweepArgs(["--pr", "9", "--yolo"]);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toContain("unknown argument '--yolo'");
    expect(message).toContain(SWEEP_USAGE);
  });
});

describe("parseGateArgs", () => {
  test("the happy path: the PR and the head the checks were verified on", () => {
    expect(parseGateArgs(["--pr", "361", "--sha", "abc1234"])).toEqual({
      pr: 361,
      head: "abc1234",
    });
  });

  test("a missing --pr is refused", () => {
    expect(() => parseGateArgs(["--sha", "abc1234"])).toThrow(
      /--pr is required/,
    );
  });

  test("a non-numeric --pr is refused", () => {
    expect(() => parseGateArgs(["--pr", "abc", "--sha", "abc1234"])).toThrow(
      /wants a number/,
    );
  });

  test("a missing --sha is refused — an unchecked head is not a merge condition", () => {
    expect(() => parseGateArgs(["--pr", "361"])).toThrow(/--sha is required/);
  });

  test("an option starved of its value is refused, with the gate usage", () => {
    for (const flag of ["--pr", "--sha"]) {
      expect(() => parseGateArgs([flag])).toThrow(
        new RegExp(`missing value for ${flag}`),
      );
    }
    expect(GATE_USAGE).toContain("sweep gate");
  });

  test("an unknown argument is refused", () => {
    expect(() =>
      parseGateArgs(["--pr", "361", "--sha", "abc1234", "--yolo"]),
    ).toThrow(/unknown argument '--yolo'/);
  });
});

describe("parseAttributeArgs", () => {
  test("the happy path: the PR whose threads will be attributed", () => {
    expect(parseAttributeArgs(["--pr", "401"])).toEqual({ pr: 401 });
  });

  test("a missing --pr is refused", () => {
    expect(() => parseAttributeArgs([])).toThrow(/--pr is required/);
  });

  test("a non-numeric --pr is refused", () => {
    expect(() => parseAttributeArgs(["--pr", "abc"])).toThrow(/wants a number/);
  });

  test("an option starved of its value is refused, with the attribute usage", () => {
    expect(() => parseAttributeArgs(["--pr"])).toThrow(
      /missing value for --pr/,
    );
    expect(ATTRIBUTE_USAGE).toContain("sweep attribute");
  });

  test("an unknown argument is refused", () => {
    expect(() => parseAttributeArgs(["--pr", "401", "--yolo"])).toThrow(
      /unknown argument '--yolo'/,
    );
  });
});

/**
 * The four commands the merge script calls. Each has exactly the arguments it
 * documents and refuses everything else — a command that silently ignored a
 * stray argument would let a mistyped call look like a successful one.
 */
describe("parseKeepBothArgs", () => {
  test("the happy path: exactly one file", () => {
    expect(parseKeepBothArgs(["src/a.ts"])).toEqual({ path: "src/a.ts" });
  });

  test("no file at all is refused", () => {
    expect(() => parseKeepBothArgs([])).toThrow(/exactly one file/);
  });

  test("two files are refused — the resolver writes one file or none", () => {
    expect(() => parseKeepBothArgs(["a.ts", "b.ts"])).toThrow(
      /exactly one file/,
    );
  });

  test("a flag where the file belongs is refused", () => {
    expect(() => parseKeepBothArgs(["--all"])).toThrow(
      /needs the file to resolve/,
    );
  });

  test("an empty path is refused", () => {
    expect(() => parseKeepBothArgs([""])).toThrow(/needs the file to resolve/);
  });

  test("the usage line names the bin", () => {
    expect(KEEP_BOTH_USAGE).toContain("hexagen-orchestration-sweep");
  });
});

describe("parseAppendOnlyArgs", () => {
  test("the happy path: one or more paths, in order", () => {
    expect(parseAppendOnlyArgs(["a", "b", "c"]).paths).toEqual(["a", "b", "c"]);
  });

  test("no path at all is refused — a check that checked nothing must not pass", () => {
    expect(() => parseAppendOnlyArgs([])).toThrow(/at least one path/);
  });

  test("a flag among the paths is refused", () => {
    expect(() => parseAppendOnlyArgs(["a", "--all"])).toThrow(/takes paths/);
  });

  test("the usage line names the bin", () => {
    expect(APPEND_ONLY_USAGE).toContain("hexagen-orchestration-sweep");
  });
});

describe("parseChecksArgs", () => {
  test("no arguments is the happy path: the array arrives on stdin", () => {
    expect(parseChecksArgs([])).toEqual({});
  });

  test("an argument is refused, with the stdin usage", () => {
    expect(() => parseChecksArgs(["runs.json"])).toThrow(/on stdin/);
    expect(CHECKS_USAGE).toContain("hexagen-orchestration-sweep");
  });
});

describe("parseConfigArgs", () => {
  test("requiredCheck is the one field it answers", () => {
    expect(parseConfigArgs(["requiredCheck"])).toEqual({
      field: "requiredCheck",
    });
  });

  test("no field is refused", () => {
    expect(() => parseConfigArgs([])).toThrow(/exactly one field/);
  });

  test("two fields are refused", () => {
    expect(() => parseConfigArgs(["requiredCheck", "planDir"])).toThrow(
      /exactly one field/,
    );
  });

  test("a field this command cannot answer is refused, naming the usage", () => {
    expect(() => parseConfigArgs(["planDir"])).toThrow(/no field 'planDir'/);
    expect(CONFIG_USAGE).toContain("hexagen-orchestration-sweep");
  });
});
