import { describe, expect, test, vi } from "vitest";
import {
  EXIT_MALFORMED,
  runCli,
  type HandoffCliIo,
} from "../../src/handoff-check/cli.js";
import {
  EXIT_NOT_READY,
  EXIT_READY,
} from "../../src/handoff-check/lib/check.js";

const handoffText = JSON.stringify({
  version: 1,
  lane: "W1",
  files: ["a.test.ts"],
  rules: [
    { id: "conflict", statement: "disagreements win", test: "conflict wins" },
  ],
});

const SRC = `test("conflict wins", () => {})`;

const io = (over: Partial<HandoffCliIo> = {}) => {
  const log = vi.fn<(t: string) => void>(() => undefined);
  const logError = vi.fn<(t: string) => void>(() => undefined);
  return {
    log,
    logError,
    io: {
      argv: ["h.json"],
      log,
      logError,
      readFile: async () => handoffText,
      deps: {
        readFile: async () => SRC,
        failingTests: async () => ["conflict wins"],
      },
      ...over,
    } as HandoffCliIo,
  };
};

describe("runCli", () => {
  test("exits 0 when every rule is bound to a failing test", async () => {
    const { io: i, log } = io();
    expect(await runCli(i)).toBe(EXIT_READY);
    expect(log).toHaveBeenCalledWith(
      "W1: 1 rule(s), each bound to a failing test. Ready for stage 2.",
    );
  });

  test("exits 1 and names the rule when its test already passes", async () => {
    const { io: i, log } = io({
      deps: { readFile: async () => SRC, failingTests: async () => [] },
    });
    expect(await runCli(i)).toBe(EXIT_NOT_READY);
    expect(log.mock.calls[0]?.[0]).toContain("NOT RED   conflict");
  });

  test("refuses with usage when given no path", async () => {
    const { io: i, logError } = io({ argv: [] });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError).toHaveBeenCalledWith(
      "usage: handoff:check <handoff.json>",
    );
  });

  test("refuses an empty path rather than reading the working directory", async () => {
    expect(await runCli(io({ argv: [""] }).io)).toBe(EXIT_MALFORMED);
  });

  test("reports an unreadable handoff as malformed, not as unready", async () => {
    const { io: i, logError } = io({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("cannot read h.json: ENOENT");
  });

  test("keeps a non-Error throw from readFile", async () => {
    const { io: i, logError } = io({
      readFile: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "disk on fire";
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("disk on fire");
  });

  test("an unreadable declared file is unusable, not unready", async () => {
    const { io: i, logError } = io({
      deps: {
        readFile: async () => {
          throw new Error("ENOENT: a.test.ts");
        },
        failingTests: async () => [],
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("h.json: ENOENT: a.test.ts");
  });

  test("keeps a non-Error throw from the check", async () => {
    const { io: i, logError } = io({
      deps: {
        readFile: async () => SRC,
        failingTests: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw "runner vanished";
        },
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("runner vanished");
  });

  test("a runner that produces nothing is reported, not scored", async () => {
    const { io: i, logError } = io({
      deps: {
        readFile: async () => SRC,
        failingTests: async () => {
          throw new Error("vitest produced no JSON report");
        },
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("no JSON report");
  });

  test("reports a malformed handoff with its reason, prefixed by the path", async () => {
    const { io: i, logError } = io({ readFile: async () => '{"version":2}' });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("h.json: version must be 1");
  });
});
