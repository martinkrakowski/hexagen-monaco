import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

/**
 * F8: `init` and `doctor` bound to the current directory.
 *
 * These run the BUILT bins, from a subdirectory of a real git repository,
 * because the defect lives in the bin's top-level wiring (`loadConfigFor()` with
 * no root), which nothing that calls the library functions can reach.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const bin = (name: string): string =>
  join(PACKAGE_ROOT, "dist/bins", `${name}.js`);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A git repository with an overlay, a ci.yml and an `agents_md: false` record. */
function repository(overlay: readonly string[]): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "orchestration-sub-"));
  dirs.push(root);
  const git = spawnSync("git", ["init", "-q"], { cwd: root });
  expect(git.status).toBe(0);
  mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
  for (const file of overlay) {
    writeFileSync(
      join(root, ".agents/orchestration", file),
      file === "config.yaml"
        ? "repo: acme/demo\nforbiddenPorts: [3000]\n"
        : `# ${file}\n`,
    );
  }
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "name: ci\n");
  writeFileSync(
    join(root, ".hexagen-template-config.json"),
    JSON.stringify({
      schemaVersion: "1",
      templates: {
        orchestration: {
          installedAt: "2026-09-29T00:00:00.000Z",
          version: "0.1.0",
          answers: { agents_md: false },
          generatedFiles: [],
        },
      },
    }),
  );
  const sub = join(root, "packages/deep/er");
  mkdirSync(sub, { recursive: true });
  return { root, sub };
}

const run = (name: string, cwd: string, env?: NodeJS.ProcessEnv) =>
  spawnSync(process.execPath, [bin(name)], { cwd, encoding: "utf8", env });

/**
 * A PATH on which the tools the doctor looks for (`gh`, `yarn`) always exist,
 * as stubs in a directory of the test's own, ahead of the host's PATH. A test
 * that asserts on "is not on PATH" must not pass or fail by what the host
 * happens to have installed.
 */
function pathWithDoctorTools(): NodeJS.ProcessEnv {
  const stubs = mkdtempSync(join(tmpdir(), "orchestration-stubs-"));
  dirs.push(stubs);
  for (const tool of ["gh", "yarn"]) {
    writeFileSync(join(stubs, tool), "#!/bin/sh\nexit 0\n");
    chmodSync(join(stubs, tool), 0o755);
  }
  return {
    ...process.env,
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- PATH is this test's own way of putting its stubs ahead of the host's tools; it is not a build input.
    PATH: `${stubs}${delimiter}${process.env.PATH ?? ""}`,
  };
}

beforeAll(() => {
  expect(existsSync(bin("doctor")), "run `yarn build` first").toBe(true);
});

describe("F8: the bins find the repository root from a subdirectory", () => {
  test("doctor reads the real overlay and the real ci.yml", () => {
    const { sub } = repository([
      "config.yaml",
      "house-rules.md",
      "cast.md",
      "lessons.md",
    ]);
    const result = run("doctor", sub);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).not.toContain("no overlay at");
    expect(out).not.toContain("ci.yml is missing");
    // It read THIS overlay: the resolved repo is not asked of gh, and the
    // forbidden port from the file is honoured.
    expect(out).not.toContain("[repo]");
    expect(result.status).not.toBe(2);
  });

  test("a relative `check` resolves against the repository root, not the subdirectory", () => {
    const { root, sub } = repository(["config.yaml"]);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/x"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(root, "scripts/x"), 0o755);
    writeFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      [
        "repo: acme/demo",
        "laneHosts:",
        "  - name: here",
        "    dispatch: [sh]",
        "    gate: full",
        "    check: [./scripts/x]",
        "",
      ].join("\n"),
    );
    const result = run("doctor", sub);
    const out = `${result.stdout}${result.stderr}`;
    // A positive floor first: a bin that crashed, or dropped the host, would
    // also print nothing about `./scripts/x`, and the negative alone would pass.
    expect(out, "doctor did not walk the host `here`").toContain(
      "WARN  [lane-host here]",
    );
    expect(out, "the check ran from the subdirectory").not.toContain(
      "./scripts/x",
    );
  });

  test("a relative `dispatch[0]` resolves against the repository root, not the subdirectory", () => {
    const { root, sub } = repository(["config.yaml"]);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/x"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(root, "scripts/x"), 0o755);
    writeFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      [
        "repo: acme/demo",
        "laneHosts:",
        "  - name: here",
        "    dispatch: [./scripts/x]",
        "    gate: full",
        "",
      ].join("\n"),
    );
    // With the doctor's own tools stubbed onto PATH, the only thing left that
    // can be "not on PATH" is the dispatch command this test is about.
    const env = pathWithDoctorTools();
    const result = run("doctor", sub, env);
    const out = `${result.stdout}${result.stderr}`;
    expect(out, "doctor did not walk the host `here`").toContain(
      "WARN  [lane-host here]",
    );
    expect(out, "dispatch[0] was resolved from the subdirectory").not.toContain(
      "is not on PATH",
    );

    // And the assertion can fail: the same run with a dispatch command that
    // exists nowhere says so, by name.
    writeFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      [
        "repo: acme/demo",
        "laneHosts:",
        "  - name: here",
        "    dispatch: [./scripts/absent]",
        "    gate: full",
        "",
      ].join("\n"),
    );
    const broken = run("doctor", sub, env);
    expect(`${broken.stdout}${broken.stderr}`).toContain(
      "dispatch[0] (./scripts/absent) is not on PATH",
    );
  });

  test("init scaffolds at the root, honours agents_md: false, and writes nothing in the subdirectory", () => {
    const { root, sub } = repository(["config.yaml"]);
    const configBefore = readFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      "utf8",
    );
    const result = run("init", sub);
    expect(result.status).toBe(0);

    const rules = readFileSync(
      join(root, ".agents/orchestration/house-rules.md"),
      "utf8",
    );
    expect(rules).not.toContain("Wave Observability");
    expect(existsSync(join(root, ".agents/orchestration/cast.md"))).toBe(true);
    expect(
      readFileSync(join(root, ".agents/orchestration/config.yaml"), "utf8"),
    ).toBe(configBefore);
    expect(existsSync(join(sub, ".agents"))).toBe(false);
  });
});

/** `run` with arguments and an explicit environment. */
const runWith = (
  name: string,
  cwd: string,
  args: readonly string[],
  env: Record<string, string>,
) =>
  spawnSync(process.execPath, [bin(name), ...args], {
    cwd,
    encoding: "utf8",
    env,
  });

describe("the other bins read and spawn from the repository root, not the cwd", () => {
  test("plan-verify: the plan is read from the root and its premise runs there", () => {
    const { root, sub } = repository(["config.yaml"]);
    writeFileSync(join(root, "marker.txt"), "here");
    mkdirSync(join(root, "docs/planning"), { recursive: true });
    writeFileSync(
      join(root, "docs/planning/p.md"),
      "# plan\n\n```premise L1\ntest -f marker.txt\n```\n",
    );
    const out = mkdtempSync(join(tmpdir(), "orchestration-art-"));
    dirs.push(out);
    const result = runWith("plan-verify", sub, [], {
      HOME: out,
      PLAN_VERIFY_ARTIFACT: join(out, "plan-verify.json"),
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("1 premise(s) hold");
    expect(result.status).toBe(0);
    expect(existsSync(join(out, "plan-verify.json"))).toBe(true);
  });

  test("handoff-check: the declared test file is read and run from the root", () => {
    const { root, sub } = repository(["config.yaml"]);
    // The temp repo has no vitest of its own, so borrow this worktree's.
    symlinkSync(
      resolve(PACKAGE_ROOT, "../../node_modules"),
      join(root, "node_modules"),
    );
    writeFileSync(
      join(root, "t.test.ts"),
      'import { test } from "vitest";\ntest("a rule", () => {\n  throw new Error("red");\n});\n',
    );
    writeFileSync(
      join(root, "handoff.json"),
      JSON.stringify({
        version: 1,
        lane: "L1",
        files: ["t.test.ts"],
        rules: [{ id: "R1", statement: "s", test: "a rule" }],
      }),
    );
    const result = runWith("handoff-check", sub, ["handoff.json"], {
      HOME: root,
      // vitest's bin is `#!/usr/bin/env node`, so node's own directory is enough.
      PATH: dirname(process.execPath),
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("each bound to a failing");
    expect(result.status).toBe(0);
  }, 60_000);

  test("control-bytes: a control byte planted at the root is reported from a subdirectory", () => {
    const { root, sub } = repository(["config.yaml"]);
    writeFileSync(join(root, "planted.txt"), Buffer.from("ok\u0000bad\n"));
    const result = runWith("control-bytes", sub, [], { HOME: root });
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBe(2);
    expect(result.stderr).toContain("planted.txt");
  });
});
