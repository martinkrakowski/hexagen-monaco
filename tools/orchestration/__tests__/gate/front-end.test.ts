import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The gate's front end, at the built bin.
 *
 * The bin is what reads the overlay, so these run `node dist/bins/gate.js`
 * against a real temp git repository — the overlay has to be a file on disk
 * for `loadConfigFor` to find, and a temp repo is the only way to be sure the
 * walk-up found THAT repository and not a checkout above it.
 *
 * What is pinned here is the order of the decisions, because the order is what
 * keeps a refusal from running anything:
 *
 *   a present-but-invalid overlay refuses before step one, names the offending
 *   setting, and runs nothing;
 *   an empty resolved list refuses and names `gateSteps`;
 *   `--print-steps` prints the list, exits 0, reads no `package.json` and spawns
 *   nothing — including for a step whose command would create a file;
 *   a missing script is skipped only when the step says `optional: true`, and is
 *   reported as SKIPPED; without `optional: true` it refuses before step one.
 */

const dist = (name: string): string =>
  resolve(import.meta.dirname, "../../dist/bins", `${name}.js`);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A git repository holding an overlay and a `package.json`. */
function repository(options: {
  readonly config: string;
  readonly scripts?: Record<string, string>;
  readonly packageJson?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), "orchestration-gate-"));
  dirs.push(root);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
  writeFileSync(
    join(root, ".agents/orchestration/config.yaml"),
    options.config,
  );
  if (options.packageJson !== undefined) {
    writeFileSync(join(root, "package.json"), options.packageJson);
  } else {
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(
        { name: "fixture", private: true, scripts: options.scripts ?? {} },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

interface GateRun {
  status: number | null;
  stdout: string;
  stderr: string;
  root: string;
}

function runGate(root: string, args: string[] = []): GateRun {
  const result = spawnSync(process.execPath, [dist("gate"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HOME: root },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    root,
  };
}

/** The overlay both fixtures below start from. */
const WITH_BOTH_MUTATE_STEPS = [
  "repo: acme/demo",
  "planDir: docs/planning",
  "mutate: true",
  "gateSteps:",
  "  - name: build",
  "    command: yarn build",
  "  - name: verify-manifests",
  "    command: npx --no-install hexagen-orchestration-verify-manifests",
  "  - name: mutate",
  "    command: npx --no-install hexagen-orchestration-mutate",
  "",
].join("\n");

describe("the gate front end", () => {
  test("a present config with an unknown key exits 2, names it, and never runs a step", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: build",
        "    command: touch would-have-run",
        "nope: 1",
        "",
      ].join("\n"),
    });
    const result = runGate(root);
    expect(result.status).toBe(2);
    // The refusal names the offending setting — this is what makes the test
    // real, because the stub this replaced also exited 2 and said nothing.
    expect(result.stderr).toContain("nope");
    expect(result.stderr).toContain("refusing to run");
    // And the step's command, which creates a file, never ran.
    expect(existsSync(join(root, "would-have-run"))).toBe(false);
    expect(result.stdout).not.toContain("==>");
  });

  test("an empty gateSteps refuses with exit 2 and names gateSteps", () => {
    const root = repository({
      config: "repo: acme/demo\nplanDir: docs/planning\n",
    });
    const result = runGate(root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("gateSteps");
    expect(result.stdout).not.toContain("steps passed");
  });

  test("a config whose only steps are mutate-only, with mutate: false, refuses naming gateSteps", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "mutate: false",
        "gateSteps:",
        "  - name: mutate",
        "    command: npx --no-install hexagen-orchestration-mutate",
        "",
      ].join("\n"),
    });
    const result = runGate(root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("gateSteps");
    expect(result.stdout).not.toContain("steps passed");
  });
});

describe("--print-steps", () => {
  test("prints the resolved list in config order, with a final newline and nothing else", () => {
    // The equality fixture: `mutate: true`, so nothing is omitted and the
    // output IS the config's own `name<TAB>command` pairs, line for line.
    const root = repository({ config: WITH_BOTH_MUTATE_STEPS });
    const result = runGate(root, ["--print-steps"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        "build\tyarn build",
        "verify-manifests\tnpx --no-install hexagen-orchestration-verify-manifests",
        "mutate\tnpx --no-install hexagen-orchestration-mutate",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toBe("");
  });

  test("mutate: false drops the verify-manifests step and the mutate step", () => {
    const root = repository({
      config: WITH_BOTH_MUTATE_STEPS.replace("mutate: true", "mutate: false"),
    });
    const result = runGate(root, ["--print-steps"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("build\tyarn build\n");
    expect(result.stdout).not.toContain("verify-manifests");
    expect(result.stdout).not.toContain("hexagen-orchestration-mutate");
  });

  test("mutate: true keeps both, so the two fixtures differ on the same config", () => {
    const kept = runGate(repository({ config: WITH_BOTH_MUTATE_STEPS }), [
      "--print-steps",
    ]);
    const dropped = runGate(
      repository({
        config: WITH_BOTH_MUTATE_STEPS.replace("mutate: true", "mutate: false"),
      }),
      ["--print-steps"],
    );
    expect(kept.stdout).toContain("verify-manifests");
    expect(kept.stdout).toContain("hexagen-orchestration-mutate");
    expect(dropped.stdout).toBe("build\tyarn build\n");
  });

  test("runs nothing, even for a step whose command would create a file", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: side-effect",
        "    command: touch would-have-run",
        "  - name: another",
        "    command: touch would-have-run-either",
        "",
      ].join("\n"),
    });
    const result = runGate(root, ["--print-steps"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "side-effect\ttouch would-have-run\nanother\ttouch would-have-run-either\n",
    );
    expect(existsSync(join(root, "would-have-run"))).toBe(false);
    expect(existsSync(join(root, "would-have-run-either"))).toBe(false);
  });

  test("never reads package.json, so a step naming an absent script still prints", () => {
    // `--print-steps` answers BEFORE the skip rule: a project that has not run
    // `yarn install` yet still has a package.json, and one that has not created
    // one at all must still be able to ask what the gate would run.
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: build",
        "    command: yarn build",
        "",
      ].join("\n"),
      packageJson: "this is not JSON at all",
    });
    const printed = runGate(root, ["--print-steps"]);
    expect(printed.status).toBe(0);
    expect(printed.stdout).toBe("build\tyarn build\n");

    // The same config, WITHOUT the flag, refuses: the missing script is a real
    // refusal, and it is only `--print-steps` that is exempt.
    const run = runGate(root);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("build");
  });
});

describe("skips (a skipped step is never a passed step)", () => {
  test("an optional step whose script is absent is SKIPPED and counted", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: check:env",
        "    command: yarn check:env",
        "    optional: true",
        "  - name: ok",
        '    command: "true"',
        "  - name: also-ok",
        '    command: "true"',
        "",
      ].join("\n"),
      scripts: {},
    });
    const result = runGate(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "SKIPPED check:env (no check:env script in package.json)",
    );
    // No `==>` line for it: it did not run.
    expect(result.stdout).not.toContain("==> [1/3]");
    expect(result.stdout).toContain("==> [2/3] ok");
    // One skipped out of three: the tally keeps the skipped step in its
    // denominator and never prints a green 3/3.
    expect(result.stdout).toContain("gate: 2/3 steps passed, 1 skipped");
    expect(result.stdout).not.toContain("gate: 3/3 steps passed");
  });

  test("the same step without optional: true refuses with exit 2 before step one", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: check:env",
        "    command: yarn check:env",
        "  - name: ok",
        '    command: "true"',
        "",
      ].join("\n"),
      scripts: {},
    });
    const result = runGate(root);
    expect(result.status).toBe(2);
    // It names the step AND the script, so the operator knows which line of the
    // overlay to look at and what it was looking for.
    expect(result.stderr).toContain("check:env");
    expect(result.stderr).toContain("optional");
    // Before step one: no `==>` line was printed at all.
    expect(result.stdout).not.toContain("==>");
    expect(result.stdout).not.toContain("steps passed");
  });

  test("an optional step whose script IS present runs normally", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: check:env",
        "    command: yarn check:env",
        "    optional: true",
        "",
      ].join("\n"),
      scripts: { "check:env": "node -e \"console.log('ran the env check')\"" },
    });
    const result = runGate(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ran the env check");
    expect(result.stdout).not.toContain("SKIPPED");
    expect(result.stdout).toContain("gate: 1/1 steps passed");
  });
});

describe("the run itself", () => {
  test("runs every resolved step, in order, and adopts the loop's exit code", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: first",
        "    command: printf 'first ran\\n'",
        "  - name: second",
        "    command: printf 'second ran\\n'",
        "  - name: third",
        "    command: sh -c 'exit 7'",
        "  - name: never",
        "    command: printf 'never ran\\n'",
        "",
      ].join("\n"),
      scripts: {},
    });
    const result = runGate(root, ["--lane", "demo"]);
    expect(result.status).toBe(7);
    expect(result.stdout).toContain("first ran");
    expect(result.stdout).toContain("second ran");
    expect(result.stdout).not.toContain("never ran");
    expect(result.stderr).toContain("FAILED at step 'third' (exit 7)");
  });

  test("--print-steps is consumed by the front end and never reaches the loop", () => {
    // The loop takes no such flag and refuses an unknown one with exit 2, so a
    // flag left in the argv would turn a working gate into a refusal.
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: ok",
        '    command: "true"',
        "",
      ].join("\n"),
      scripts: {},
    });
    const result = runGate(root, ["--print-steps"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("runs the steps from the project root, with the project's own binaries first on PATH", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: cwd",
        "    command: pwd",
        "",
      ].join("\n"),
      scripts: {},
    });
    const result = runGate(root);
    expect(result.status).toBe(0);
    // The step runs where the project is, not where the caller happened to be.
    expect(result.stdout).toContain(realpath(root));

    // A step that resolves a tool by name finds the project's own copy: a
    // `node_modules/.bin` entry the loop's PATH points at first.
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", ".bin", "a-gate-tool"),
      "#!/bin/sh\necho 'the project tool'\n",
    );
    expect(
      spawnSync("chmod", [
        "+x",
        join(root, "node_modules", ".bin", "a-gate-tool"),
      ]).status,
    ).toBe(0);
    writeFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: tool",
        "    command: a-gate-tool",
        "",
      ].join("\n"),
    );
    const withTool = runGate(root);
    expect(withTool.status).toBe(0);
    expect(withTool.stdout).toContain("the project tool");
  });

  test("takes the machine-wide lock around a step the overlay marks locked, and releases it", () => {
    const root = repository({
      config: [
        "repo: acme/demo",
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: plain",
        '    command: test ! -d "$TMPDIR/hexagen-gate.lock"',
        "  - name: protected",
        '    command: test -d "$TMPDIR/hexagen-gate.lock"',
        "    locked: true",
        "",
      ].join("\n"),
      scripts: {},
    });
    const dir = mkdtempSync(join(tmpdir(), "hexagen-gate-tmpdir-"));
    dirs.push(dir);
    const result = spawnSync(process.execPath, [dist("gate")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, HOME: root, TMPDIR: dir },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<== plain: exit 0");
    expect(result.stdout).toContain("<== protected: exit 0");
    // Released as soon as the last locked step is done.
    expect(existsSync(join(dir, "hexagen-gate.lock"))).toBe(false);
  });
});

/** macOS resolves temp directories through a symlink; `pwd` prints the real one. */
function realpath(path: string): string {
  return spawnSync("pwd", ["-P"], {
    cwd: path,
    encoding: "utf8",
  }).stdout.trim();
}

/** The overlay under the fixture, so a test can prove the file it wrote is the one read. */
const overlayPath = (root: string): string =>
  join(root, ".agents/orchestration", "config.yaml");

test("the fixture overlay is where the bin looks for it", () => {
  // Liveness, in the plainest possible form: the temp repo the tests build is a
  // real git repository with a real overlay in it, and the built bin refuses an
  // invalid one by name. If the walk-up were reading a checkout above this
  // directory, that refusal could not happen at all.
  const root = repository({ config: "repo: acme/demo\nnope: 1\n" });
  expect(existsSync(overlayPath(root))).toBe(true);
  expect(readFileSync(overlayPath(root), "utf8")).toContain("nope: 1");
  expect(runGate(root).stderr).toContain("nope");
});
