import { afterEach, describe, expect, test } from "vitest";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The bin, driven the way a caller drives it: as a PROCESS, over the built
 * artifact, from a real temporary project.
 *
 * The source's bin test called exported functions. This bin has none on purpose:
 * it is the process edge, it loads the overlay once at import time, and a module
 * that does that cannot be imported by a unit test without also starting the
 * tool. So every case here spawns `node dist/bins/wave-status.js` and reads its
 * exit code, its streams, and — for the server face — its socket.
 *
 * That is also the only way to prove what the brief asks for about the two roots
 * and the repository: the scan root the bin CHOSE is observable only as the
 * waves it then prints.
 */

const BUILT_BIN = resolve(
  import.meta.dirname,
  "../../dist/bins/wave-status.js",
);

const dirs: string[] = [];
const running: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill("SIGKILL");
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/**
 * A temporary project: a git worktree the root finder recognises, and an
 * overlay. `repo` is what the config contract needs, and naming it in the file
 * is also what keeps `gh` out of the load entirely.
 */
function makeProject(configYaml: string): string {
  const root = tempDir("wave-status-bin-");
  spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  mkdirSync(join(root, ".agents", "orchestration"), { recursive: true });
  writeFileSync(
    join(root, ".agents", "orchestration", "config.yaml"),
    configYaml,
  );
  return root;
}

/**
 * A stub `gh` on the child's PATH. The collector asks the real `gh` for the
 * repository's pull requests on every collection, and a test that reaches the
 * network is a test that fails on someone else's machine. Fixed command, fixed
 * arguments, fixed answer.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- PATH is this test's own way of putting a stub gh ahead of the real one on the CHILD's environment; it is not a turbo pipeline input. */
function stubGhOnPath(): string {
  const bin = tempDir("wave-status-stub-");
  const gh = join(bin, "gh");
  writeFileSync(gh, "#!/bin/sh\nprintf '[]'\n");
  chmodSync(gh, 0o755);
  return bin;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runBin(
  projectRoot: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Run {
  const result = spawnSync(process.execPath, [BUILT_BIN, ...args], {
    encoding: "utf8",
    cwd: projectRoot,
    // A bound, so a bin that wrongly keeps running fails the case it broke
    // instead of wedging the whole file.
    timeout: 30_000,
    killSignal: "SIGKILL",
    env: {
      ...process.env,
      PATH: `${stubGhOnPath()}:${process.env.PATH ?? ""}`,
      // A config-less environment, so nothing on this machine decides the case.
      WAVE_LOG_ROOT: "",
      LOGDIR: "",
      PORT: "",
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** A wave directory with one lane, and the events that make it a lane. */
function writeWave(logRoot: string, wave: string, lane: string): void {
  const dir = join(logRoot, `wave-${wave}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "events.jsonl"),
    `${JSON.stringify({
      ts: "2026-09-12T10:00:00Z",
      wave,
      lane,
      stage: "implement",
      event: "settled",
    })}\n`,
  );
  writeFileSync(join(dir, `${lane}.log`), "building\nEXIT 0\n");
}

/** A wave under the per-repository root, and one under a sibling directory. */
function writeBothRoots(home: string, mine: string, theirs: string): void {
  mkdirSync(join(home, ".waves-demo"), { recursive: true });
  mkdirSync(join(home, ".waves"), { recursive: true });
  writeWave(join(home, ".waves-demo"), mine, "a1");
  writeWave(join(home, ".waves"), theirs, "o1");
}

const REPO_CONFIG = [
  "repo: acme/demo",
  "planDir: docs/planning",
  "forbiddenPorts: []",
  "",
].join("\n");

describe("the built bin, over a real temporary project", () => {
  test("the built artifact exists — every case below depends on it", () => {
    const result = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    // A missing build would make every assertion below a false green, so the
    // absence is named rather than absorbed.
    expect(
      spawnSync("test", ["-f", BUILT_BIN], { encoding: "utf8" }).status,
      `${BUILT_BIN} must exist — run \`yarn build\` first`,
    ).toBe(0);
  });
});

describe("the scan root is the per-repository one (requirement 3)", () => {
  test("with no waveLogDir and repo acme/demo, the wave under the home directory's per-repo root is rendered", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeBothRoots(home, "Mine", "Theirs");

    const run = runBin(project, ["--print"], { HOME: home });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("wave Mine");
    expect(run.stdout).toContain("Mine/a1");
  });

  test("a wave directory under the shared home-directory root is NOT scanned", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeBothRoots(home, "Mine", "Theirs");

    const run = runBin(project, ["--print"], { HOME: home });

    // The shared root is the directory the source scanned by default, and it is
    // the reason a wave belonging to another project shows false "no PR" flags.
    // A wave written there is simply not this repository's.
    expect(run.stdout).not.toContain("wave Theirs");
    expect(run.stdout).not.toContain("Theirs/o1");
  });

  test("a config that sets waveLogDir moves the scanned root there", () => {
    const home = tempDir("wave-status-home-");
    const elsewhere = tempDir("wave-status-elsewhere-");
    const project = makeProject(
      [
        "repo: acme/demo",
        `waveLogDir: ${elsewhere}`,
        "forbiddenPorts: []",
        "",
      ].join("\n"),
    );
    writeWave(elsewhere, "Mine", "a1");
    writeBothRoots(home, "Home", "Theirs");

    const run = runBin(project, ["--print"], { HOME: home });

    expect(run.stdout).toContain("wave Mine");
    expect(run.stdout).not.toContain("wave Home");
  });

  test("--root moves the scan root for one run, and needs --print to be read", () => {
    const elsewhere = tempDir("wave-status-flagged-");
    const project = makeProject(REPO_CONFIG);
    writeWave(elsewhere, "Flagged", "f1");

    const printed = runBin(project, ["--print", "--root", elsewhere]);
    expect(printed.status, printed.stderr).toBe(0);
    expect(printed.stdout).toContain("wave Flagged");

    // Without --print the flag names a face that is not running.
    const bare = runBin(project, ["--root", elsewhere]);
    expect(bare.status).toBe(2);
    expect(bare.stderr).toMatch(/unknown argument: "--root"/);
  });
});

describe("the config contract (requirement 3)", () => {
  test("a config with no repo exits 2, names `repo`, and neither binds nor scans", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(["planDir: docs/planning", ""].join("\n"));
    writeBothRoots(home, "Mine", "Theirs");

    const run = runBin(project, ["--print"], { HOME: home });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("repo");
    expect(run.stdout).toBe("");
    // Neither face ran: no render, and no URL on the stream either.
    expect(run.stdout).not.toContain("wave Mine");
  });

  test("a config that exists and has problems is a refusal: exit 2, every problem, nothing rendered", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(
      ["repo: not-an-owner-name", "waveStatusPort: nonsense", ""].join("\n"),
    );
    writeWave(join(home, ".waves-demo"), "Mine", "a1");

    const run = runBin(project, ["--print"], { HOME: home });

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("wave-status: refusing to");
    expect(run.stderr).toContain("repo");
    expect(run.stderr).toContain("waveStatusPort");
    expect(run.stdout).toBe("");
  });

  test("an ABSENT config is not a refusal — the defaults stand", () => {
    const project = tempDir("wave-status-no-config-");
    spawnSync("git", ["init", "--quiet", project], { encoding: "utf8" });

    const run = runBin(project, ["--print"]);

    // It renders, and refuses for the one thing it genuinely cannot do without.
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("repo");
  });
});

describe("a one-shot --print whose collection fails", () => {
  test("names the malformed row on stderr, exits 1, and prints no stack trace", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeWave(join(home, ".waves-demo"), "Mine", "PZ1");
    mkdirSync(join(project, "docs", "planning"), { recursive: true });
    writeFileSync(
      join(project, "docs", "planning", "plan.md"),
      [
        "# The plan",
        "",
        "| Lane | Risk | Delivers |",
        "|---|---|---|",
        // A plain `high`: the risk reader refuses it rather than reading it as
        // low-stakes, and the refusal has to reach the operator as a message.
        "| **PZ1** | high | Split the reserved list. |",
        "",
      ].join("\n"),
    );

    const run = runBin(project, ["--print"], { HOME: home });

    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("PZ1");
    expect(run.stderr).toContain("plan.md");
    // Not an unhandled rejection: no frame of a stack, and no Node banner.
    expect(run.stderr).not.toMatch(/\n\s+at /);
    expect(run.stderr).not.toContain("Node.js v");
    expect(run.stdout).toBe("");
  });
});

describe("the two faces", () => {
  test("no arguments serves the read-only server, and GET / is the page", async () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeWave(join(home, ".waves-demo"), "Mine", "a1");

    const child = spawn(process.execPath, [BUILT_BIN], {
      cwd: project,
      env: {
        ...process.env,
        PATH: `${stubGhOnPath()}:${process.env.PATH ?? ""}`,
        WAVE_LOG_ROOT: "",
        LOGDIR: "",
        HOME: home,
        // An ephemeral port: the default one may already be in use on a machine
        // that is running something else, and this test is about the page.
        PORT: "0",
      },
    });
    running.push(child);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    const url = await new Promise<string>((resolveUrl, rejectUrl) => {
      const deadline = Date.now() + 20_000;
      const tick = (): void => {
        const match = /wave-status serving (http:\/\/127\.0\.0\.1:\d+)/.exec(
          stdout,
        );
        if (match?.[1] !== undefined) {
          resolveUrl(match[1]);
          return;
        }
        if (Date.now() > deadline) {
          rejectUrl(
            new Error(
              `the server never printed its URL; stdout was: ${stdout}`,
            ),
          );
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });

    expect(stdout).toContain("read-only");
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("<table");
    expect(html).toContain('<link rel="stylesheet" href="/tokens.css"');
    // And the built-in tokens answer, because this project set none.
    const tokens = await fetch(`${url}/tokens.css`);
    expect(tokens.status).toBe(200);
    expect(await tokens.text()).toContain("--color-background");
  }, 60_000);

  test("--watch without --print is an unknown argument and exits 2", () => {
    const project = makeProject(REPO_CONFIG);
    const run = runBin(project, ["--watch"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unknown argument: "--watch"/);
  });

  test("an unknown argument exits 2 and says which one", () => {
    const project = makeProject(REPO_CONFIG);
    const run = runBin(project, ["--colour"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unknown argument: "--colour"/);
  });
});

describe("the port is the overlay's (A-20)", () => {
  const CONFIG_FORBIDDING = (port: number): string =>
    [
      "repo: acme/demo",
      `waveStatusPort: ${port}`,
      `forbiddenPorts: [${port}]`,
      "",
    ].join("\n");

  test("a waveStatusPort the file forbids is refused, naming the port and forbiddenPorts", () => {
    const project = makeProject(CONFIG_FORBIDDING(4520));
    const run = runBin(project, []);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("4520");
    expect(run.stderr).toContain("forbiddenPorts");
    // And it never bound: no URL was printed.
    expect(run.stdout).toBe("");
  });

  // The port is a fact of the SERVE path only. A one-shot `--print` binds
  // nothing, so a PORT that the file forbids (or that is not a number at all)
  // must not stop it from printing.
  test("--print with PORT=3000 and forbiddenPorts: [3000] still prints", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(
      ["repo: acme/demo", "forbiddenPorts: [3000]", ""].join("\n"),
    );
    writeWave(join(home, ".waves-demo"), "Mine", "a1");

    const run = runBin(project, ["--print"], { HOME: home, PORT: "3000" });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("wave Mine");
    expect(run.stderr).not.toContain("forbiddenPorts");
  });

  test("--print with a PORT that is not a number still prints", () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeWave(join(home, ".waves-demo"), "Mine", "a1");

    const run = runBin(project, ["--print"], { HOME: home, PORT: "nonsense" });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("wave Mine");
  });

  test("PORT pointing at a forbidden port is refused by the same rule", () => {
    const project = makeProject(
      [
        "repo: acme/demo",
        "waveStatusPort: 4520",
        "forbiddenPorts: [4520]",
        "",
      ].join("\n"),
    );
    const run = runBin(project, [], { PORT: "4520" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("4520");
    expect(run.stderr).toContain("forbiddenPorts");
  });

  // The red proof that the hardcoded refusal is gone: the source threw on these
  // two numbers whatever the file said. Here the file says nothing, so they are
  // ordinary ports and the bin must not refuse them.
  //
  // It binds the port only if this host has it free — a machine already running
  // something on it is exactly the situation the hardcoded refusal was a
  // placeholder for, and this test must not depend on the absence of one. What
  // it asserts is the REFUSAL, not the bind: the bin neither exits 2 nor says
  // anything about forbiddenPorts, and when the socket did open, the page is
  // served on it.
  test("PORT=3000 with an empty forbiddenPorts is ALLOWED — RED PROOF", async () => {
    const home = tempDir("wave-status-home-");
    const project = makeProject(REPO_CONFIG);
    writeWave(join(home, ".waves-demo"), "Mine", "a1");

    const child = spawn(process.execPath, [BUILT_BIN], {
      cwd: project,
      env: {
        ...process.env,
        PATH: `${stubGhOnPath()}:${process.env.PATH ?? ""}`,
        WAVE_LOG_ROOT: "",
        LOGDIR: "",
        HOME: home,
        PORT: "3000",
      },
    });
    running.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolveExit) => {
      child.on("exit", (code) => resolveExit(code));
    });

    const bound = await new Promise<boolean>((resolveBound) => {
      const deadline = Date.now() + 20_000;
      const tick = (): void => {
        if (stdout.includes("wave-status serving")) {
          resolveBound(true);
          return;
        }
        if (Date.now() > deadline) {
          resolveBound(false);
          return;
        }
        setTimeout(tick, 25);
      };
      tick();
    });

    if (bound) {
      expect(stdout).toContain("http://127.0.0.1:3000");
      const page = await fetch("http://127.0.0.1:3000/");
      expect(page.status).toBe(200);
    } else {
      // The host had it spoken for. The refusal must still be absent: a
      // hardcoded rule would have exited 2 here with a message about a reserved
      // port, and the bin would have printed no URL.
      const code = await exited;
      expect(stderr, "the bin refused a port nothing forbade").not.toMatch(
        /forbiddenPorts|refusing to bind/i,
      );
      expect(code).not.toBe(2);
    }
  }, 60_000);

  test("PORT=3000 IS refused when the file lists it, naming the port and forbiddenPorts", () => {
    const project = makeProject(
      [
        "repo: acme/demo",
        "waveStatusPort: 4318",
        "forbiddenPorts: [3000, 3001]",
        "",
      ].join("\n"),
    );
    const run = runBin(project, [], { PORT: "3000" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("3000");
    expect(run.stderr).toContain("forbiddenPorts");
  });
});
