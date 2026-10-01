import { describe, expect, test } from "vitest";
import { ArgError, parseLaneWatchArgs } from "../../src/lane-watch/args.js";

const base = ["--server", "http://127.0.0.1:4097", "--session", "ses_abc"];

describe("parseLaneWatchArgs", () => {
  test("parses follow and usage with --server and --session", () => {
    expect(parseLaneWatchArgs(["follow", ...base])).toMatchObject({
      command: "follow",
      origin: "http://127.0.0.1:4097",
      session: "ses_abc",
    });
    expect(parseLaneWatchArgs(["usage", ...base])).toMatchObject({
      command: "usage",
    });
  });

  test("accepts --flag=value", () => {
    expect(
      parseLaneWatchArgs([
        "usage",
        "--server=http://localhost:1",
        "--session=ses_a",
      ]),
    ).toMatchObject({ origin: "http://localhost:1", session: "ses_a" });
  });

  test("follow has a default stall window and takes --stall-seconds", () => {
    const dflt = parseLaneWatchArgs(["follow", ...base]);
    expect(dflt.command === "follow" && dflt.stallMs).toBe(120_000);
    const custom = parseLaneWatchArgs([
      "follow",
      ...base,
      "--stall-seconds",
      "0.5",
    ]);
    expect(custom.command === "follow" && custom.stallMs).toBe(500);
  });

  test.each([
    [[], "no subcommand"],
    [["nope", ...base], "unknown subcommand"],
    [["follow", "--session", "ses_a"], "missing --server"],
    [["follow", "--server", "http://127.0.0.1:1"], "missing --session"],
    [["follow", ...base, "--bogus", "1"], "unknown flag"],
    [["follow", ...base, "--server", "http://127.0.0.1:2"], "duplicate flag"],
    [
      ["follow", "--server", "http://example.com", "--session", "ses_a"],
      "non-loopback",
    ],
    [
      ["follow", "--server", "http://127.0.0.1:1", "--session", "../x"],
      "bad session",
    ],
    [
      ["follow", "--server", "http://127.0.0.1:1", "--session", "a b"],
      "bad session 2",
    ],
    [["usage", ...base, "--stall-seconds", "5"], "stall flag is follow-only"],
    [["follow", ...base, "--stall-seconds", "0"], "zero stall"],
    [["follow", ...base, "--stall-seconds", "abc"], "non-numeric stall"],
    [["follow", "--server"], "flag without value"],
    [["follow", ...base, "extra"], "stray positional"],
  ])("refuses %j (%s)", (argv) => {
    expect(() => parseLaneWatchArgs(argv as string[])).toThrow(ArgError);
  });
});
