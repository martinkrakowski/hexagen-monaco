import { describe, expect, test } from "vitest";
import {
  listingCommand,
  parseVitestCommand,
  provable,
} from "../../src/mutate-manifest/lib/commands.js";

describe("parseVitestCommand", () => {
  test("reads the file filter and the -t pattern out of the shape every manifest uses", () => {
    expect(
      parseVitestCommand([
        "yarn",
        "vitest",
        "run",
        "--project",
        "web",
        "packages/panels/src/__tests__/board.test.tsx",
        "-t",
        "keeps a draft",
      ]),
    ).toEqual({
      files: ["packages/panels/src/__tests__/board.test.tsx"],
      pattern: "keeps a draft",
    });
  });

  test("reports no pattern when the command selects by file alone", () => {
    expect(
      parseVitestCommand(["yarn", "vitest", "run", "a/b.test.ts"]),
    ).toEqual({
      files: ["a/b.test.ts"],
      pattern: undefined,
    });
  });

  test("accepts the long spelling of -t", () => {
    expect(
      parseVitestCommand([
        "yarn",
        "vitest",
        "run",
        "--testNamePattern",
        "a case",
      ]).pattern,
    ).toBe("a case");
  });

  test("never mistakes a flag's value for a file — `--project web` is not a filter", () => {
    expect(
      parseVitestCommand(["yarn", "vitest", "run", "--project", "web"]).files,
    ).toEqual([]);
  });

  test("leaves an inline `--flag=value` alone: it carries its own value", () => {
    expect(
      parseVitestCommand([
        "yarn",
        "vitest",
        "run",
        "--maxWorkers=2",
        "a/b.test.ts",
      ]).files,
    ).toEqual(["a/b.test.ts"]);
  });

  test("keeps more than one file filter", () => {
    expect(
      parseVitestCommand(["yarn", "vitest", "run", "a.test.ts", "b.test.tsx"])
        .files,
    ).toEqual(["a.test.ts", "b.test.tsx"]);
  });

  test("claims only positionals that name a test file", () => {
    expect(
      parseVitestCommand(["yarn", "vitest", "run", "tools", "t/a.test.ts"])
        .files,
    ).toEqual(["t/a.test.ts"]);
  });

  test("swallows `--json`'s argument, which vitest treats as an output path and OVERWRITES", () => {
    // Measured the hard way: `vitest list --json tools/report/__tests__/rollup.test.ts`
    // does not list that file, it writes the report over it.
    expect(
      parseVitestCommand(["yarn", "vitest", "list", "--json", "a/b.test.ts"])
        .files,
    ).toEqual([]);
  });
});

describe("provable", () => {
  test("accepts an unanchored pattern: a name built from syntax is a suffix of the real one", () => {
    expect(provable("keeps a draft")).toBe(true);
  });

  test("refuses `^`, which a missed suite wrapper would turn into a false proof", () => {
    expect(provable("^keeps a draft")).toBe(false);
  });

  test("refuses `$` on the same reasoning rather than arguing the direction case by case", () => {
    expect(provable("keeps a draft$")).toBe(false);
  });
});

describe("listingCommand", () => {
  test("turns the recorded command into the same command, collecting", () => {
    expect(
      listingCommand([
        "yarn",
        "vitest",
        "run",
        "--project",
        "web",
        "a.test.ts",
      ]),
    ).toEqual(["yarn", "vitest", "list", "--project", "web", "a.test.ts"]);
  });

  test("rewrites only the `run` that follows `vitest`, leaving an argument spelled `run` alone", () => {
    expect(listingCommand(["npx", "vitest", "run", "-t", "run"])).toEqual([
      "npx",
      "vitest",
      "list",
      "-t",
      "run",
    ]);
  });

  test("refuses a command that is not a vitest run at all", () => {
    expect(
      listingCommand(["./script.sh", "-c", "config.json"]),
    ).toBeUndefined();
  });

  test("refuses `vitest` invoked in some other mode", () => {
    expect(listingCommand(["yarn", "vitest", "bench"])).toBeUndefined();
  });
});
