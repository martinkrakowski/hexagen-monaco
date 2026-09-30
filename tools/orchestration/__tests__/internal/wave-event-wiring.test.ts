import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig } from "../../src/internal/config.js";
import {
  buildWaveEventDeps,
  nodeWaveEventIo,
  type WaveEventIo,
} from "../../src/internal/wave-event-wiring.js";

/**
 * The bin's environment and config assembly (F10, F11, F12).
 *
 * `src/bins/wave-event.ts` runs at import time, so no test can load it; the
 * existing suite calls `runWaveEvent` directly and never sees how the bin builds
 * its inputs. All three of these defects were in that assembly, so it lives in
 * `wave-event-wiring.ts` and is tested here, plus once end to end against the
 * built bin.
 */

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orchestration-we-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

interface Recorder {
  readonly io: WaveEventIo;
  readonly appended: string[];
  readonly created: string[];
  readonly stderr: string[];
}

/** An io that touches nothing and records everything. */
function recorder(directories: readonly string[] = []): Recorder {
  const appended: string[] = [];
  const created: string[] = [];
  const stderr: string[] = [];
  return {
    appended,
    created,
    stderr,
    io: {
      isDirectory: (path) => directories.includes(path),
      mkdir: async (path) => void created.push(path),
      appendFile: async (path) => void appended.push(path),
      clock: () => "2026-09-29T00:00:00Z",
      stderr: (line) => void stderr.push(line),
    },
  };
}

describe("buildWaveEventDeps", () => {
  const config = { ...emptyConfig(), repo: "owner/demo" };

  test("carries repo and waveLogDir only when the config has them", () => {
    const rec = recorder();
    expect(buildWaveEventDeps({}, emptyConfig(), rec.io).config).toEqual({});
    expect(
      buildWaveEventDeps({}, { ...config, waveLogDir: "/w" }, rec.io).config,
    ).toEqual({ repo: "owner/demo", waveLogDir: "/w" });
  });
});

describe("nodeWaveEventIo", () => {
  test("mkdir is recursive and appendFile appends", async () => {
    const dir = join(scratch(), "a", "b");
    await nodeWaveEventIo.mkdir(dir);
    await nodeWaveEventIo.appendFile(join(dir, "events.jsonl"), "one\n");
    await nodeWaveEventIo.appendFile(join(dir, "events.jsonl"), "two\n");
    expect(readFileSync(join(dir, "events.jsonl"), "utf8")).toBe("one\ntwo\n");
  });
});
