import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// A real run() would shell out to turbo (preflight) and the arch-linter, both
// of which are irrelevant to this test — the only thing being verified is that
// SyncEngineOptions.noPreflight is forwarded to ensureDependenciesBuilt.
const ensureDependenciesBuiltMock = vi.hoisted(() => vi.fn());
const runArchLinterMock = vi.hoisted(() => vi.fn());

vi.mock("../src/preflight.js", () => ({
  ensureDependenciesBuilt: ensureDependenciesBuiltMock,
}));

vi.mock("../src/linter.js", () => ({
  runArchLinter: runArchLinterMock,
}));

import { SyncEngine } from "../src/sync-engine.js";

function makeLogger() {
  return {
    info: vi.fn(),
    errorWithException: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeTmpWorkspace(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hexagen-sync-no-preflight-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "t",
      private: true,
      workspaces: ["packages/*"],
    }),
    "utf8",
  );
  // The sync lock lives in .architecture/.sync.lock, so the directory must
  // exist for LockFile.acquire() (run() in self-regen mode) to succeed.
  mkdirSync(path.join(dir, ".architecture"), { recursive: true });
  return dir;
}

describe("SyncEngine — --no-preflight", () => {
  let tmpDir: string;

  beforeEach(() => {
    ensureDependenciesBuiltMock.mockClear();
    runArchLinterMock.mockClear();
    tmpDir = makeTmpWorkspace();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("forwards { skip: true } when noPreflight is set", async () => {
    const engine = new SyncEngine(
      {
        dryRun: false,
        force: false,
        forceRoot: false,
        allowDirty: true,
        strict: false,
        mode: "self-regen",
        logger: makeLogger(),
      },
      {
        targetRoot: tmpDir,
        manifest: { bounded_contexts: [] },
        noPreflight: true,
      },
    );

    await engine.run();

    expect(ensureDependenciesBuiltMock).toHaveBeenCalledTimes(1);
    expect(ensureDependenciesBuiltMock.mock.calls[0][1]).toEqual({
      skip: true,
    });
  });

  it("forwards a falsy skip when noPreflight is not set", async () => {
    const engine = new SyncEngine(
      {
        dryRun: false,
        force: false,
        forceRoot: false,
        allowDirty: true,
        strict: false,
        mode: "self-regen",
        logger: makeLogger(),
      },
      {
        targetRoot: tmpDir,
        manifest: { bounded_contexts: [] },
      },
    );

    await engine.run();

    expect(ensureDependenciesBuiltMock).toHaveBeenCalledTimes(1);
    expect(ensureDependenciesBuiltMock.mock.calls[0][1]).toEqual({
      skip: undefined,
    });
  });
});
