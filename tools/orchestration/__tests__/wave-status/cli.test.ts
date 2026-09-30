/* eslint-disable no-control-regex -- this file asserts that a painted terminal line carries no escape byte it did not paint, so it has to name the byte. */
import { describe, expect, test, vi } from "vitest";
import { parseArgs, runCli, type CliIo } from "../../src/wave-status/cli.js";
import type { WaveStatus } from "../../src/internal/wave-types.js";

const status: WaveStatus = {
  generatedAt: "2026-09-09T00:00:00Z",
  waves: [
    {
      id: "T",
      lanes: [
        { wave: "T", lane: "t1", derived: { alive: true }, disagreements: [] },
      ],
    },
  ],
};

/** The scan root the bin resolved from the overlay, injected so no test walks the real one. */
const SCAN_ROOT = "/logs/waves-demo";

function makeIo(argv: readonly string[], overrides: Partial<CliIo> = {}) {
  const log = vi.fn<(text: string) => void>(() => undefined);
  const logError = vi.fn<(text: string) => void>(() => undefined);
  const collect = vi.fn<(root: string) => Promise<WaveStatus>>(
    async () => status,
  );
  const schedule = vi.fn<(fn: () => void, ms: number) => void>(() => undefined);
  const serve = vi.fn<
    (options: { port: number; scanRoot: string }) => Promise<{ url: string }>
  >(async () => ({ url: "http://127.0.0.1:4318" }));
  const io: CliIo = {
    argv,
    defaultScanRoot: SCAN_ROOT,
    port: () => 4318,
    isTTY: true,
    noColor: false,
    log,
    logError,
    collect,
    schedule,
    serve,
    ...overrides,
  };
  return { io, log, logError, collect, schedule, serve };
}

describe("parseArgs — no arguments serves, --print prints", () => {
  test("no arguments is the SERVER face, which takes no arguments at all", () => {
    expect(parseArgs([])).toEqual({ face: "serve" });
  });

  test("--print alone is a one-shot render at the resolved root", () => {
    expect(parseArgs(["--print"])).toEqual({ face: "print", watch: false });
  });

  // The three cases that decide whether a bare flag is an error: with no
  // --print there is no face reading them, and honouring one anyway would run a
  // face the operator did not ask for.
  test("--watch WITHOUT --print is an unknown argument", () => {
    expect(() => parseArgs(["--watch"])).toThrow(/unknown argument: "--watch"/);
    expect(() => parseArgs(["--watch=2"])).toThrow(
      /unknown argument: "--watch=2"/,
    );
  });

  test("--root and --root= WITHOUT --print are unknown arguments", () => {
    expect(() => parseArgs(["--root", "/w"])).toThrow(
      /unknown argument: "--root"/,
    );
    expect(() => parseArgs(["--root=/w"])).toThrow(
      /unknown argument: "--root=\/w"/,
    );
  });

  test("any other argument is refused too", () => {
    expect(() => parseArgs(["--print", "--port=4318"])).toThrow(
      /unknown argument/,
    );
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument: "--nope"/);
  });

  test("--watch defaults to 10 seconds; --watch=N overrides it", () => {
    expect(parseArgs(["--print", "--watch"])).toEqual({
      face: "print",
      watch: 10,
    });
    expect(parseArgs(["--print", "--watch=2"])).toEqual({
      face: "print",
      watch: 2,
    });
  });

  test("--root takes a separate path or an = form", () => {
    expect(parseArgs(["--print", "--root", "/logs/other"])).toEqual({
      face: "print",
      watch: false,
      root: "/logs/other",
    });
    expect(parseArgs(["--print", "--root=/logs/other"])).toEqual({
      face: "print",
      watch: false,
      root: "/logs/other",
    });
  });

  test("flags combine, and --print may sit anywhere", () => {
    expect(parseArgs(["--root", "/w", "--watch=5", "--print"])).toEqual({
      face: "print",
      watch: 5,
      root: "/w",
    });
  });

  test("a non-integer or non-positive --watch is refused", () => {
    expect(() => parseArgs(["--print", "--watch=0"])).toThrow(
      /invalid --watch/,
    );
    expect(() => parseArgs(["--print", "--watch=abc"])).toThrow(
      /invalid --watch/,
    );
    expect(() => parseArgs(["--print", "--watch=1.5"])).toThrow(
      /invalid --watch/,
    );
    expect(() => parseArgs(["--print", "--watch="])).toThrow(/invalid --watch/);
  });

  test("--root without a path is refused", () => {
    expect(() => parseArgs(["--print", "--root"])).toThrow(
      /--root requires a path/,
    );
  });

  test("--root refuses a value that begins with '-' (e.g. a later flag) and an empty value", () => {
    expect(() => parseArgs(["--print", "--root", "--watch=2"])).toThrow(
      /--root requires a path/,
    );
    expect(() => parseArgs(["--print", "--root="])).toThrow(
      /--root requires a path/,
    );
    expect(() => parseArgs(["--print", "--root", ""])).toThrow(
      /--root requires a path/,
    );
  });

  test("--root refuses a path that begins with '-' and the = form too", () => {
    expect(() => parseArgs(["--print", "--root", "-flag"])).toThrow(/--root/);
    expect(() => parseArgs(["--print", "--root=-flag"])).toThrow(/--root/);
  });
});

describe("runCli", () => {
  test("collects once, renders once, and does not schedule", async () => {
    const { io, log, collect, schedule } = makeIo(["--print"]);
    expect(await runCli(io)).toBe(0);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
    const printed = String(log.mock.calls[0]?.[0]);
    expect(printed).toContain("wave T");
    expect(printed).toContain("T/t1");
    expect(printed).toContain("alive");
  });

  test("colour is on only for a TTY with NO_COLOR unset", async () => {
    const tty = makeIo(["--print"]);
    await runCli(tty.io);
    expect(String(tty.log.mock.calls[0]?.[0])).toMatch(/\x1b\[/);

    const noColor = makeIo(["--print"], { noColor: true });
    await runCli(noColor.io);
    expect(String(noColor.log.mock.calls[0]?.[0])).not.toMatch(/\x1b/);

    const notTTY = makeIo(["--print"], { isTTY: false });
    await runCli(notTTY.io);
    expect(String(notTTY.log.mock.calls[0]?.[0])).not.toMatch(/\x1b/);
  });

  test("the scan root comes from --root, else from the one the bin resolved", async () => {
    const explicit = makeIo(["--print", "--root", "/from-flag"]);
    await runCli(explicit.io);
    expect(explicit.collect).toHaveBeenCalledWith("/from-flag");

    const resolved = makeIo(["--print"]);
    await runCli(resolved.io);
    expect(resolved.collect).toHaveBeenCalledWith(SCAN_ROOT);
  });

  test("no arguments binds the server on the resolved port and scan root, and prints its URL", async () => {
    const { io, log, collect, serve } = makeIo([]);
    expect(await runCli(io)).toBe(0);
    // The server face collects nothing itself: it is the server's own startup
    // collection, and the two faces never disagree about the root because both
    // were handed the same one.
    expect(collect).not.toHaveBeenCalled();
    expect(serve).toHaveBeenCalledWith({ port: 4318, scanRoot: SCAN_ROOT });
    expect(String(log.mock.calls[0]?.[0])).toContain("http://127.0.0.1:4318");
    expect(String(log.mock.calls[0]?.[0])).toContain("read-only");
  });

  test("the print face never resolves the port; the serve face refuses a port it cannot resolve", async () => {
    const port = vi.fn<() => number>(() => {
      throw new Error(
        "refusing to bind port 1: it is listed in forbiddenPorts.",
      );
    });
    const printed = makeIo(["--print"], { port });
    expect(await runCli(printed.io)).toBe(0);
    expect(port).not.toHaveBeenCalled();

    const served = makeIo([], { port });
    expect(await runCli(served.io)).toBe(2);
    expect(port).toHaveBeenCalledTimes(1);
    expect(served.serve).not.toHaveBeenCalled();
    expect(served.logError).toHaveBeenCalledWith(
      expect.stringContaining("forbiddenPorts"),
    );
  });

  test("--watch re-collects on the requested interval until interrupted", async () => {
    const { io, log, collect, schedule } = makeIo(["--print", "--watch=2"]);
    await runCli(io);
    expect(schedule).toHaveBeenCalledTimes(1);
    const [fn, ms] = schedule.mock.calls[0] as [() => void, number];
    expect(ms).toBe(2000);
    fn();
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
  });

  test("--watch without a value uses the default interval", async () => {
    const { io, schedule } = makeIo(["--print", "--watch"]);
    await runCli(io);
    expect(schedule.mock.calls[0]?.[1]).toBe(10000);
  });

  test("a collect that outlives the interval never overlaps the next refresh", async () => {
    const late: Array<() => void> = [];
    let calls = 0;
    const collect = vi.fn<(root: string) => Promise<WaveStatus>>(async () => {
      calls += 1;
      if (calls >= 2) await new Promise<void>((resolve) => late.push(resolve));
      return status;
    });
    const { io, schedule } = makeIo(["--print", "--watch=2"], { collect });
    await runCli(io);
    expect(calls).toBe(1);
    const [fn] = schedule.mock.calls[0] as [() => void, number];
    fn();
    await vi.waitFor(() => expect(calls).toBe(2));
    fn(); // the interval fires again while the previous collect is still held open
    expect(calls).toBe(2); // no overlapping collect started
    late.shift()?.();
    await vi.waitFor(() => expect(schedule).toHaveBeenCalledTimes(2));
  });

  test("an unknown argument rejects", async () => {
    const { io, logError } = makeIo(["--nope"]);
    // Exit 2, not a rejection: an argument this tool does not have is a usage
    // error, and a caller reading the code needs to see that number.
    expect(await runCli(io)).toBe(2);
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/unknown argument: "--nope"/),
    );
  });

  test("a one-shot --print whose first collect throws prints the message and exits 1, with no rejection", async () => {
    // The source caught this, printed the message, and exited 1. A port that
    // let the rejection escape gave the operator a stack trace and an unhandled
    // rejection instead of the one line naming what could not be read.
    const collect = vi.fn<(root: string) => Promise<WaveStatus>>(async () => {
      throw new Error("plan.md: row PZ9 has an invalid risk cell");
    });
    const { io, log, logError, schedule } = makeIo(["--print"], { collect });
    await expect(runCli(io)).resolves.toBe(1);
    expect(logError).toHaveBeenCalledWith(
      "plan.md: row PZ9 has an invalid risk cell",
    );
    expect(log).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  test("--print --watch whose FIRST collect throws also exits 1 rather than watching a broken view", async () => {
    const collect = vi.fn<(root: string) => Promise<WaveStatus>>(async () => {
      throw new Error("gh failed");
    });
    const { io, logError, schedule } = makeIo(["--print", "--watch=1"], {
      collect,
    });
    await expect(runCli(io)).resolves.toBe(1);
    expect(logError).toHaveBeenCalledWith("gh failed");
    expect(schedule).not.toHaveBeenCalled();
  });

  test("a failed collect reports the error and the next tick still prints", async () => {
    let calls = 0;
    const collect = vi.fn<(root: string) => Promise<WaveStatus>>(async () => {
      calls += 1;
      if (calls === 2) throw new Error("gh failed");
      if (calls === 3) throw "log file vanished";
      return status;
    });
    const { io, log, logError, schedule } = makeIo(["--print", "--watch=1"], {
      collect,
    });
    await runCli(io);
    expect(log).toHaveBeenCalledTimes(1);
    const [fn] = schedule.mock.calls[0] as [() => void, number];
    fn();
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith("gh failed"));
    const [fn2] = schedule.mock.calls[1] as [() => void, number];
    fn2();
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith("log file vanished"),
    );
    const [fn3] = schedule.mock.calls[2] as [() => void, number];
    fn3();
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(2));
  });
});
