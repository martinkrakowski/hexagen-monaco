import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { execFile } from "node:child_process";
import { join } from "node:path";
import {
  EXIT_MALFORMED,
  EXIT_UNRESTORED,
  createRealDeps,
  onSignal,
  realDeps,
  runCli,
  type ManifestCliIo,
} from "../../src/mutate-manifest/cli.js";
import {
  EXIT_MISMATCH,
  EXIT_VERIFIED,
  type ScratchDeps,
} from "../../src/mutate-manifest/lib/replay.js";
import type { MutationDeps } from "../../src/mutate/lib/types.js";

const manifestText = JSON.stringify({
  version: 1,
  lane: "W4",
  mutations: [
    {
      file: "target.ts",
      before: "alpha",
      after: "beta",
      because: "the guard must red",
      command: ["run", "tests"],
      verdict: "caught",
    },
  ],
});

/** Green on the untouched source — the baseline — and `commandExit` once mutated. */
const deps = (commandExit: number): MutationDeps => {
  let current = Buffer.from("alpha", "utf8");
  return {
    readFile: async (path) => (path.endsWith(".before") ? "alpha" : "beta"),
    readFileBuffer: async () => current,
    writeFileBuffer: async (_p, buffer) => {
      current = Buffer.from(buffer);
    },
    execute: async () => ({
      exitCode: current.toString("utf8") === "alpha" ? 0 : commandExit,
      stdout: "",
      stderr: "",
    }),
  };
};

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "mutate-manifest-cli-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const scratch: ScratchDeps = {
  makeDir: async () => "/scratch",
  writeText: async () => undefined,
  removeDir: async () => undefined,
  join: (...parts) => parts.join("/"),
};

const io = (over: Partial<ManifestCliIo> = {}) => {
  const log = vi.fn<(text: string) => void>(() => undefined);
  const logError = vi.fn<(text: string) => void>(() => undefined);
  return {
    log,
    logError,
    io: {
      argv: ["m.json"],
      log,
      logError,
      readFile: async () => manifestText,
      deps: deps(1),
      scratch,
      ...over,
    } as ManifestCliIo,
  };
};

describe("runCli", () => {
  test("exits 0 and reports when every claimed verdict reproduces", async () => {
    const { io: i, log } = io();
    expect(await runCli(i)).toBe(EXIT_VERIFIED);
    expect(log).toHaveBeenCalledWith(
      "W4: 1 mutation(s) re-run, every verdict reproduced.",
    );
  });

  test("exits 1 and names the mismatch when a claim does not reproduce", async () => {
    const { io: i, log } = io({ deps: deps(0) });
    expect(await runCli(i)).toBe(EXIT_MISMATCH);
    expect(log.mock.calls[0]?.[0]).toContain("MISMATCH  target.ts");
  });

  test("refuses with usage when given no manifest path", async () => {
    const { io: i, logError } = io({ argv: [] });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError).toHaveBeenCalledWith(
      "usage: hexagen-orchestration-mutate-verify <manifest.json>",
    );
  });

  test("refuses an empty path rather than reading the working directory", async () => {
    const { io: i } = io({ argv: [""] });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
  });

  test("reports an unreadable manifest as malformed, not as a mismatch", async () => {
    const { io: i, logError } = io({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("cannot read m.json: ENOENT");
  });

  test("reports a non-Error throw from readFile without losing it", async () => {
    const { io: i, logError } = io({
      readFile: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "disk on fire";
      },
    });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain(
      "cannot read m.json: disk on fire",
    );
  });

  test("reports a malformed manifest with the reason, prefixed by its path", async () => {
    const { io: i, logError } = io({ readFile: async () => '{"version":2}' });
    expect(await runCli(i)).toBe(EXIT_MALFORMED);
    expect(logError.mock.calls[0]?.[0]).toContain("m.json: version must be 1");
  });

  test("reports a red baseline rather than verifying a claim it never checked", async () => {
    const { io: i, log } = io({ deps: execBaseline(1) });
    expect(await runCli(i)).toBe(EXIT_MISMATCH);
    expect(log.mock.calls[0]?.[0]).toContain("RED BASELINE  target.ts");
  });
});

/** A command that exits `baselineExit` on the untouched source, `1` once mutated. */
const execBaseline = (baselineExit: number): MutationDeps => {
  let current = Buffer.from("alpha", "utf8");
  return {
    ...deps(1),
    writeFileBuffer: async (_p, buffer) => {
      current = Buffer.from(buffer);
    },
    execute: async () => ({
      exitCode: current.toString("utf8") === "alpha" ? baselineExit : 1,
      stdout: "",
      stderr: "",
    }),
  };
};

describe("realDeps", () => {
  test("wires onSignal, which runMutation calls to restore before the process dies", () => {
    expect(realDeps.onSignal).toBe(onSignal);
  });

  test("restores on an interrupt instead of leaving the file mutated", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const cleanup = vi.fn(async () => undefined);
    const unregister = realDeps.onSignal!(cleanup);

    process.emit("SIGINT");
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(130));
    expect(cleanup).toHaveBeenCalledTimes(1);

    unregister();
    exitSpy.mockRestore();
  });

  test("onSignal says so loudly and refuses when the restore fails", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unregister = realDeps.onSignal!(async () => {
      throw new Error("disk full");
    });

    process.emit("SIGINT");
    await vi.waitFor(() =>
      expect(exitSpy).toHaveBeenCalledWith(EXIT_UNRESTORED),
    );
    expect(errSpy).toHaveBeenCalledWith("disk full");

    unregister();
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("onSignal reports a restore failure that is not an Error", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unregister = realDeps.onSignal!(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "raw restore failure";
    });

    process.emit("SIGHUP");
    await vi.waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith("raw restore failure"),
    );
    expect(exitSpy).toHaveBeenCalledWith(EXIT_UNRESTORED);

    unregister();
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("onSignal unregisters, so a later signal is not ours to answer", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const cleanup = vi.fn(async () => undefined);
    realDeps.onSignal!(cleanup)();
    process.emit("SIGINT");
    expect(cleanup).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  test("execute reports the exit code and the output of a command that ran", async () => {
    const green = await realDeps.execute([
      process.execPath,
      "-e",
      "process.stdout.write('out')",
    ]);
    expect(green).toMatchObject({ exitCode: 0, stdout: "out", stderr: "" });
    expect(green.launchError).toBeUndefined();
    const red = await realDeps.execute([
      process.execPath,
      "-e",
      "process.stderr.write('err'); process.exit(3)",
    ]);
    expect(red).toMatchObject({ exitCode: 3, stdout: "", stderr: "err" });
    expect(red.launchError).toBeUndefined();
  });

  test("execute does not call more than 1 MiB of output a launch failure", async () => {
    const res = await realDeps.execute([
      process.execPath,
      "-e",
      "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
    ]);
    expect(res.launchError).toBeUndefined();
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toHaveLength(2 * 1024 * 1024);
  });

  test("execute names an output overflow as its own reason, not a launch failure or an exit code", async () => {
    const res = await realDeps.execute([
      process.execPath,
      "-e",
      "process.stdout.write('x'.repeat(33 * 1024 * 1024))",
    ]);
    expect(res.launchError).toContain("output exceeded");
    expect(res.launchError).not.toContain("ENOENT");
  });

  test("execute reports a launch failure as one, not as an exit code", async () => {
    const res = await realDeps.execute([
      "/nonexistent/binary/that/cannot/launch",
    ]);
    expect(res.exitCode).toBe(1);
    expect(res.launchError).toContain("ENOENT");
  });

  test("reads and writes the target file through the real filesystem", async () => {
    const path = join(tempDir(), "target.ts");
    await realDeps.writeFileBuffer(path, Buffer.from("alpha", "utf8"));
    expect(await realDeps.readFile(path)).toBe("alpha");
    expect(readFileSync(path, "utf8")).toBe("alpha");
    expect((await realDeps.readFileBuffer(path)).toString("utf8")).toBe(
      "alpha",
    );
  });
});

describe("an interrupt while the command is running", () => {
  test("the child gets SIGTERM before the file is restored and the process exits", async () => {
    const order: string[] = [];
    const child = {
      kill: vi.fn((signal: string) => {
        order.push(`kill ${signal}`);
        return true;
      }),
    };
    const fakeExecFile = (() => child) as unknown as typeof execFile;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      order.push("exit");
    }) as never);

    const deps = createRealDeps(fakeExecFile);
    const unregister = deps.onSignal!(async () => {
      order.push("restore");
    });
    void deps.execute(["some-suite"]);

    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(130));
    expect(order).toEqual(["kill SIGTERM", "restore", "exit"]);

    unregister();
    exitSpy.mockRestore();
  });
});
