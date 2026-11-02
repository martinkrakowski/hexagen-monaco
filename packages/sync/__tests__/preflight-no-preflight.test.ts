import { describe, it, expect, vi, beforeEach } from "vitest";

// preflight.ts calls promisify(exec) at import time, so the mock must exist
// before the module is imported.
const execMock = vi.hoisted(() =>
  vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: "", stderr: "" }),
  ),
);

vi.mock("node:child_process", () => ({ exec: execMock }));

import { ensureDependenciesBuilt } from "../src/preflight.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("ensureDependenciesBuilt — --no-preflight", () => {
  beforeEach(() => {
    execMock.mockClear();
  });

  it("skips the build when options.skip is true and logs the --no-preflight notice", async () => {
    const logger = makeLogger();
    const config = {
      dryRun: false,
      workspaceRoot: "/tmp/x",
      logger,
    } as never;

    await ensureDependenciesBuilt(config, { skip: true });

    expect(execMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
    const infoCall = logger.info.mock.calls[0][0] as string;
    expect(infoCall).toContain("--no-preflight");
  });

  it("runs the turbo build by default when no options are passed", async () => {
    const logger = makeLogger();
    const config = {
      dryRun: false,
      workspaceRoot: "/tmp/x",
      logger,
    } as never;

    await ensureDependenciesBuilt(config);

    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toBe("npx turbo run build");
  });

  it("lets dry-run win even when skip is false", async () => {
    const logger = makeLogger();
    const config = {
      dryRun: true,
      workspaceRoot: "/tmp/x",
      logger,
    } as never;

    await ensureDependenciesBuilt(config, { skip: false });

    expect(execMock).not.toHaveBeenCalled();
  });
});
