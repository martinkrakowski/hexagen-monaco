import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { LoggerPort } from "@hexagen/shared";
import type { SyncConfig } from "../src/config.js";

// `runArchLinter` binds `execPromise = promisify(exec)` at MODULE LOAD, so a
// spread/async mock does not intercept it — a plain factory listing `exec`
// (plus its siblings) does. `execState` is shared in via vi.hoisted so both the
// mock factory and each test can drive the child process's outcome.
const { execState } = vi.hoisted(() => ({
  execState: {
    callCount: 0,
    impl: (cb: (err: unknown, res?: unknown) => void) =>
      cb(null, { stdout: "", stderr: "" }),
  },
}));

vi.mock("node:child_process", () => ({
  exec: (
    _cmd: string,
    _opts: unknown,
    cb: (err: unknown, res?: unknown) => void,
  ) => {
    execState.callCount++;
    return execState.impl(cb);
  },
  execSync: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  default: {},
}));

// Always "installed" so every test exercises the exec path (not the skip arm).
vi.mock("../src/arch-linter-bin.js", () => ({
  resolveArchLinterBin: () => "/fake/node_modules/.bin/hexagen-lint",
}));

const {
  runArchLinter,
  resolveLinterTimeoutMs,
  isTimeoutError,
  DEFAULT_ARCH_LINTER_TIMEOUT_MS,
} = await import("../src/linter.js");

/** Records log lines so tests can assert what the linter surfaced. */
function makeConfig(overrides: { strict?: boolean; dryRun?: boolean } = {}) {
  const logs = {
    info: [] as string[],
    warn: [] as string[],
    error: [] as string[],
  };
  const logger: LoggerPort = {
    info: (m) => void logs.info.push(m),
    warn: (m) => void logs.warn.push(m),
    error: (m) => void logs.error.push(m),
    debug: () => {},
    errorWithException: () => {},
  };
  // runArchLinter only reads logger/strict/dryRun/workspaceRoot; the rest of
  // SyncConfig is irrelevant to this unit.
  const config = {
    logger,
    strict: overrides.strict ?? false,
    dryRun: overrides.dryRun ?? false,
    workspaceRoot: "/fake/workspace",
  } as unknown as SyncConfig;
  return { config, logs };
}

/** A non-zero linter exit carrying findings (a real boundary violation). */
function violation(): Error {
  return Object.assign(new Error("Command failed"), {
    code: 1,
    stderr: "R99: cross-context import violation in packages/foo",
  });
}

/** child_process's timeout kill: SIGTERM + killed, no verdict. */
function timeoutKill(): Error {
  return Object.assign(new Error("Command failed"), {
    killed: true,
    signal: "SIGTERM",
    code: null,
  });
}

beforeEach(() => {
  execState.callCount = 0;
  execState.impl = (cb) => cb(null, { stdout: "", stderr: "" });
});

describe("resolveLinterTimeoutMs", () => {
  it("defaults to 60s (raised from the old 30s) when unset", () => {
    assert.equal(DEFAULT_ARCH_LINTER_TIMEOUT_MS, 60_000);
    assert.equal(resolveLinterTimeoutMs({}), 60_000);
  });

  it("honours a positive, finite ARCH_LINTER_TIMEOUT_MS override", () => {
    assert.equal(
      resolveLinterTimeoutMs({ ARCH_LINTER_TIMEOUT_MS: "90000" }),
      90_000,
    );
  });

  it("falls back to the default for malformed / zero / negative overrides", () => {
    for (const raw of ["abc", "0", "-5", "", "NaN", "Infinity"]) {
      assert.equal(
        resolveLinterTimeoutMs({ ARCH_LINTER_TIMEOUT_MS: raw }),
        DEFAULT_ARCH_LINTER_TIMEOUT_MS,
        `expected default for ${JSON.stringify(raw)}`,
      );
    }
  });
});

describe("isTimeoutError", () => {
  it("recognises child_process's SIGTERM kill", () => {
    assert.equal(isTimeoutError(timeoutKill()), true);
  });

  it("recognises an ETIMEDOUT code", () => {
    assert.equal(isTimeoutError({ code: "ETIMEDOUT" }), true);
  });

  it("does NOT mistake a real violation exit for a timeout", () => {
    assert.equal(isTimeoutError(violation()), false);
  });

  it("is false for null / non-objects / plain errors", () => {
    assert.equal(isTimeoutError(null), false);
    assert.equal(isTimeoutError("SIGTERM"), false);
    assert.equal(isTimeoutError(new Error("boom")), false);
    // killed without SIGTERM is not our timeout signature.
    assert.equal(isTimeoutError({ killed: true, signal: "SIGKILL" }), false);
  });
});

describe("runArchLinter", () => {
  it("strict mode aborts when the linter reports a violation", async () => {
    execState.impl = (cb) => cb(violation());
    const { config, logs } = makeConfig({ strict: true });

    await assert.rejects(runArchLinter(config), /failed in strict mode/);
    // The linter's own findings were surfaced (not silently dropped).
    assert.ok(
      logs.error.some((l) => l.includes("R99")),
      "expected the linter's violation output in the error log",
    );
  });

  it("non-strict mode logs a violation but resolves (unchanged behaviour)", async () => {
    execState.impl = (cb) => cb(violation());
    const { config, logs } = makeConfig({ strict: false });

    await assert.doesNotReject(runArchLinter(config));
    assert.ok(logs.error.some((l) => l.includes("R99")));
  });

  it("a timeout aborts even in NON-strict mode (AUD-010: never a silent pass)", async () => {
    execState.impl = (cb) => cb(timeoutKill());
    const { config } = makeConfig({ strict: false });

    await assert.rejects(runArchLinter(config), /timed out/);
  });

  it("a timeout in strict mode surfaces the explicit timeout error, not the generic strict error", async () => {
    execState.impl = (cb) => cb(timeoutKill());
    const { config } = makeConfig({ strict: true });

    await assert.rejects(runArchLinter(config), (err: Error) => {
      assert.match(err.message, /timed out/);
      assert.doesNotMatch(err.message, /failed in strict mode/);
      return true;
    });
  });

  it("a clean run resolves and marks the sync stage passed", async () => {
    execState.impl = (cb) =>
      cb(null, { stdout: "Architecture is compliant.", stderr: "" });
    const { config, logs } = makeConfig({ strict: true });

    await assert.doesNotReject(runArchLinter(config));
    assert.ok(logs.info.some((l) => l.includes("Architecture check passed")));
  });

  it("dry-run short-circuits without ever invoking the linter", async () => {
    const { config, logs } = makeConfig({ dryRun: true });

    await assert.doesNotReject(runArchLinter(config));
    assert.equal(
      execState.callCount,
      0,
      "the linter must not run under --dry-run",
    );
    assert.ok(logs.info.some((l) => l.includes("[DRY-RUN]")));
  });
});
