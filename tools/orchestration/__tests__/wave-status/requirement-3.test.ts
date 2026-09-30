import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  collect,
  type CollectDeps,
} from "../../src/wave-status/lib/collect.js";

/**
 * Requirement (3), named and kept together: a wave log root is per-repository,
 * and a wave belongs to the repository its own events say it does.
 *
 * These four are the whole of it, and each is proved at the level where the
 * answer is actually decided. The first two are the collector's, because that
 * is where the events are read. The last two are the BIN's, over the built
 * artifact in a temporary project, because the root the bin CHOOSES and the
 * refusal it prints are only observable as a process.
 */

const BUILT_BIN = resolve(
  import.meta.dirname,
  "../../dist/bins/wave-status.js",
);
const REPO = "acme/demo";
const OTHER = "other/repo";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * A stub `gh` on the child's PATH, with a directory of its own. The collector
 * asks the real `gh` for the repository's pull requests on every collection, so
 * a test that let it through would depend on this machine's authentication and
 * on a repository that does not exist. Fixed command, fixed answer.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- PATH is this test's own way of putting a stub gh ahead of the real one on the CHILD environment; it is not a turbo pipeline input. */
function stubGhOnPath(): string {
  const bin = tempDir("ow3c-r3-stub-");
  const gh = join(bin, "gh");
  writeFileSync(gh, "#!/bin/sh\nprintf '[]'\n");
  chmodSync(gh, 0o755);
  return bin;
}

/** One event line, with or without a `repo`. */
function event(wave: string, lane: string, repo?: string): string {
  return `${JSON.stringify({
    ts: "2026-03-14T09:00:00Z",
    wave,
    lane,
    stage: "implement",
    event: "settled",
    ...(repo === undefined ? {} : { repo }),
  })}\n`;
}

/** deps that read one real wave log root, with `pgrep` and `gh` stubbed out. */
function depsFor(logRoot: string, planningDir: string): CollectDeps {
  return {
    repoRoot: "/repo",
    repo: REPO,
    planningDir,
    readdir: (dir) =>
      import("node:fs/promises").then(({ readdir }) => readdir(dir)),
    readFile: (path) =>
      import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8")),
    open: (path) =>
      import("node:fs/promises").then(async ({ open }) => {
        const handle = await open(path, "r");
        return {
          stat: async () => {
            const st = await handle.stat();
            return { size: st.size, mtimeMs: st.mtimeMs };
          },
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, length, position),
          close: () => handle.close(),
        };
      }),
    pgrep: async () => 0,
    gh: async () => "[]",
  };
}

/** A wave directory holding one lane, its log and its events. */
function waveDir(
  logRoot: string,
  wave: string,
  lane: string,
  lines: string[],
): void {
  const dir = join(logRoot, `wave-${wave}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), lines.join(""));
  writeFileSync(join(dir, `${lane}.log`), "building\nEXIT 0\n");
}

describe("requirement (3): a wave log root is per-repository", () => {
  test("a log root holding one wave for acme/demo, one for other/repo, and one with no repo renders the first and the third", async () => {
    const logRoot = tempDir("ow3c-r3-scoped-");
    const planning = tempDir("ow3c-r3-plans-");
    waveDir(logRoot, "Mine", "m1", [event("Mine", "m1", REPO)]);
    waveDir(logRoot, "Theirs", "o1", [event("Theirs", "o1", OTHER)]);
    // A third wave with no `repo` at all: a legacy or repo-less write. It is not
    // evidence of another repository, so it is shown.
    waveDir(logRoot, "Unscoped", "n1", [event("Unscoped", "n1")]);

    const status = await collect(
      depsFor(logRoot, planning),
      logRoot,
      "2026-03-14T12:00:00Z",
    );

    expect(status.waves.map((wave) => wave.id).sort()).toEqual([
      "Mine",
      "Unscoped",
    ]);
    expect(
      status.waves.find((wave) => wave.id === "Mine")?.lanes[0]?.lane,
    ).toBe("m1");
    expect(
      status.waves.find((wave) => wave.id === "Unscoped")?.lanes[0]?.lane,
    ).toBe("n1");
  });

  test("a wave mixing an acme/demo event and an other/repo event is hidden", async () => {
    const logRoot = tempDir("ow3c-r3-mixed-");
    const planning = tempDir("ow3c-r3-plans-");
    waveDir(logRoot, "Mixed", "m1", [
      event("Mixed", "m1", REPO),
      event("Mixed", "o1", OTHER),
    ]);

    const status = await collect(
      depsFor(logRoot, planning),
      logRoot,
      "2026-03-14T12:00:00Z",
    );

    // Hidden entirely: no group, no lane. Half a wave would put this
    // repository's pull-request numbers on the other repository's lanes, and a
    // reader would have no way to see the seam.
    expect(status.waves).toEqual([]);
  });

  test("with waveLogDir omitted and repo acme/demo, the scanned root is the home directory's per-repository one, and a wave under the shared one is not scanned", () => {
    const home = tempDir("ow3c-r3-home-");
    const project = tempDir("ow3c-r3-project-");
    spawnSync("git", ["init", "--quiet", project], { encoding: "utf8" });
    mkdirSync(join(project, ".agents", "orchestration"), { recursive: true });
    writeFileSync(
      join(project, ".agents", "orchestration", "config.yaml"),
      "repo: acme/demo\nplanDir: docs/planning\nforbiddenPorts: []\n",
    );
    // Two roots, both under the same home directory, both written with a wave.
    waveDir(join(home, ".waves-demo"), "Mine", "m1", [
      event("Mine", "m1", REPO),
    ]);
    waveDir(join(home, ".waves"), "Theirs", "o1", [event("Theirs", "o1")]);

    const run = spawnSync(process.execPath, [BUILT_BIN, "--print"], {
      encoding: "utf8",
      cwd: project,
      env: {
        ...process.env,
        PATH: `${stubGhOnPath()}:${process.env.PATH ?? ""}`,
        WAVE_LOG_ROOT: "",
        LOGDIR: "",
        HOME: home,
      },
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("wave Mine");
    expect(run.stdout).toContain("Mine/m1");
    // The shared root is a directory shared by every project on the machine, and
    // it is exactly why this root is per-repository: a wave written there is not
    // this repository's, whatever its events say.
    expect(run.stdout).not.toContain("Theirs");
  });

  test("a config without repo exits 2, naming repo, and neither binds nor scans", () => {
    const project = tempDir("ow3c-r3-norepo-");
    spawnSync("git", ["init", "--quiet", project], { encoding: "utf8" });
    mkdirSync(join(project, ".agents", "orchestration"), { recursive: true });
    writeFileSync(
      join(project, ".agents", "orchestration", "config.yaml"),
      "planDir: docs/planning\nforbiddenPorts: []\n",
    );
    // A wave under every root the tool might reach, so "neither scans" is a
    // statement about the process and not about an empty directory.
    const home = tempDir("ow3c-r3-norepo-home-");
    waveDir(join(home, ".waves"), "Any", "a1", [event("Any", "a1")]);

    const run = spawnSync(process.execPath, [BUILT_BIN, "--print"], {
      encoding: "utf8",
      cwd: project,
      env: {
        ...process.env,
        PATH: `${stubGhOnPath()}:${process.env.PATH ?? ""}`,
        WAVE_LOG_ROOT: "",
        LOGDIR: "",
        HOME: home,
      },
    });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("repo");
    // Nothing rendered and nothing bound: the refusal is the whole output.
    expect(run.stdout).toBe("");
  });
});
