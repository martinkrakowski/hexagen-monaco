import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { emptyConfig } from "../../src/internal/config.js";
import { loadConfigFor } from "../../src/internal/project.js";
import {
  buildWaveEventDeps,
  nodeWaveEventIo,
  runWaveEventForProject,
  waveEventEnv,
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

const ARGV = ["W3", "l1", "dispatch", "started"];

function project(config: string | undefined): string {
  const root = scratch();
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  return root;
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

describe("F11: HOME is passed through, never replaced by the passwd home", () => {
  const config = { ...emptyConfig(), repo: "owner/demo" };

  test("an empty HOME resolves to /tmp/.waves-demo, as wave-event.sh does", async () => {
    const rec = recorder();
    const code = await runWaveEventForProject(
      ARGV,
      { HOME: "" },
      { config, present: false, problems: [] },
      rec.io,
    );
    expect(code).toBe(0);
    expect(rec.appended).toEqual(["/tmp/.waves-demo/wave-W3/events.jsonl"]);
  });

  test("an unset HOME does too, and the env carries no HOME key at all", async () => {
    expect(waveEventEnv({})).not.toHaveProperty("HOME");
    const rec = recorder();
    await runWaveEventForProject(
      ARGV,
      {},
      { config, present: false, problems: [] },
      rec.io,
    );
    expect(rec.appended).toEqual(["/tmp/.waves-demo/wave-W3/events.jsonl"]);
  });

  test("a set HOME is passed through untouched", () => {
    expect(
      waveEventEnv({ HOME: "/home/op", LOGDIR: "/l", WAVE_LOG_ROOT: "/r" }),
    ).toEqual({
      HOME: "/home/op",
      LOGDIR: "/l",
      WAVE_LOG_ROOT: "/r",
    });
  });
});

describe("F10: a present-but-invalid config refuses instead of re-routing events", () => {
  const INVALID = [
    "cast: []",
    'waveLogDir: "$HOME/.waves-hexagen"',
    "repo: owner/demo",
    "",
  ].join("\n");

  test("exits 2, appends nothing, creates nothing, and names the problem", async () => {
    const loaded = await loadConfigFor(project(INVALID), {
      readRepository: () => "someone/else",
    });
    const rec = recorder();
    const code = await runWaveEventForProject(
      ARGV,
      { HOME: "/home/op" },
      loaded,
      rec.io,
    );
    expect(code).toBe(2);
    expect(rec.appended).toEqual([]);
    expect(rec.created).toEqual([]);
    const said = rec.stderr.join("\n");
    expect(said).toContain("cast");
    expect(said).toContain("refusing to append");
  });

  test("an ABSENT file keeps today's defaults, and still appends", async () => {
    const loaded = await loadConfigFor(project(undefined), {
      readRepository: () => "acme/demo",
    });
    const rec = recorder();
    const code = await runWaveEventForProject(
      ARGV,
      { HOME: "/home/op" },
      loaded,
      rec.io,
    );
    expect(code).toBe(0);
    expect(rec.appended).toEqual(["/home/op/.waves-demo/wave-W3/events.jsonl"]);
  });

  test("a VALID file routes to its own waveLogDir", async () => {
    const loaded = await loadConfigFor(
      project('repo: owner/demo\nwaveLogDir: "$HOME/.waves-hexagen"\n'),
      { readRepository: () => "someone/else" },
    );
    const rec = recorder();
    const code = await runWaveEventForProject(
      ARGV,
      { HOME: "/home/op" },
      loaded,
      rec.io,
    );
    expect(code).toBe(0);
    expect(rec.appended).toEqual([
      "/home/op/.waves-hexagen/wave-W3/events.jsonl",
    ]);
  });

  test("the BUILT bin refuses, and writes nothing under HOME", () => {
    const dist = resolve(import.meta.dirname, "../../dist/bins/wave-event.js");
    expect(existsSync(dist), "run `yarn build` first").toBe(true);
    const root = project(INVALID);
    expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
    const home = scratch();
    const result = spawnSync(process.execPath, [dist, ...ARGV], {
      cwd: root,
      encoding: "utf8",
      env: { HOME: home },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cast");
    expect(readdirSync(home)).toEqual([]);
  });
});
