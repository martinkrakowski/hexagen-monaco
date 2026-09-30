import { afterEach, describe, expect, test } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFor } from "../../src/internal/project.js";
import { runDoctor, type DoctorDeps } from "../../src/doctor/doctor.js";

/**
 * `loadConfigFor` — the project-facing loader the bins call.
 *
 * `gh` is injected: what is under test is what the loader does with `gh`'s
 * ANSWER, and a real `gh` would make the answer depend on the machine.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function project(config: string | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "orchestration-project-"));
  dirs.push(root);
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  return root;
}

describe("F5: a repo from gh is validated, and its problem is kept", () => {
  const gh = (answer: string | undefined) => ({
    readRepository: () => answer,
  });

  test("gh answering not-a-repo is a problem naming repo when the file is absent", async () => {
    const loaded = await loadConfigFor(project(undefined), gh("not-a-repo"));
    expect(loaded.problems.map((p) => p.at)).toEqual(["repo"]);
    expect(loaded.config.repo).toBeUndefined();
  });

  test("gh answering not-a-repo is a problem naming repo when the file is present", async () => {
    const loaded = await loadConfigFor(
      project("planDir: docs/planning\n"),
      gh("not-a-repo"),
    );
    expect(loaded.problems.map((p) => p.at)).toEqual(["repo"]);
    expect(loaded.config.repo).toBeUndefined();
  });

  test("a valid gh answer is used, with no problem", async () => {
    for (const config of [undefined, "planDir: docs/planning\n"]) {
      const loaded = await loadConfigFor(project(config), gh("acme/demo"));
      expect(loaded.problems).toEqual([]);
      expect(loaded.config.repo).toBe("acme/demo");
    }
  });

  test("F17: invalid YAML with a bad gh answer reports both the file and the repo", async () => {
    const loaded = await loadConfigFor(
      project("planDir: [unclosed\n"),
      gh("not-a-repo"),
    );
    expect(loaded.problems.map((p) => p.at).sort()).toEqual(["<file>", "repo"]);
    expect(loaded.config.repo).toBeUndefined();
  });

  test("the file's own repo wins, and gh is not consulted", async () => {
    let asked = false;
    const loaded = await loadConfigFor(project("repo: acme/own\n"), {
      readRepository: () => {
        asked = true;
        return "acme/other";
      },
    });
    expect(loaded.config.repo).toBe("acme/own");
    expect(asked).toBe(false);
  });
});

describe("F9: a schema error does not make doctor check the defaults", () => {
  const healthy: DoctorDeps = {
    exists: async () => true,
    hasCommand: async () => true,
    supportsWorktrees: async () => true,
    runCheck: async () => "failed",
    runRemote: async () => ({ status: "failed", stdout: "" }),
    localUserEmail: async () => undefined,
  };

  test("the unknown key, the port in forbiddenPorts and a failing host check are all reported in one run", async () => {
    const root = project(
      [
        "forbiddenPorts: [4318]",
        "laneHosts:",
        "  - name: local-opencode",
        "    dispatch: [opencode, run, --attach, http://127.0.0.1:9]",
        "    gate: full",
        "    check: [curl, -sf, http://127.0.0.1:9/doc]",
        "nope: 1",
        "",
      ].join("\n"),
    );
    const loaded = await loadConfigFor(root, {
      readRepository: () => "acme/demo",
    });
    const probed: string[][] = [];
    const { findings, exitCode } = await runDoctor(
      loaded.config,
      loaded.problems,
      loaded.deprecations,
      loaded.present,
      {
        ...healthy,
        runCheck: async (argv) => {
          probed.push([...argv]);
          return "failed";
        },
      },
    );

    expect(exitCode).toBe(1);
    const failing = findings.filter((f) => f.severity === "fail");
    expect(failing.find((f) => f.check === "config")?.message).toMatch(
      /^nope /,
    );
    expect(
      failing.find((f) => f.check === "waveStatusPort")?.message,
    ).toContain("4318");
    // The host's OWN check ran, on the argv the file wrote, not on a default.
    expect(
      failing.find((f) => f.check === "lane-host local-opencode"),
    ).toBeDefined();
    expect(probed).toEqual([["curl", "-sf", "http://127.0.0.1:9/doc"]]);
  });

  test("a file that is not YAML falls back to defaults, since there is nothing to read", async () => {
    const loaded = await loadConfigFor(project("planDir: [unclosed\n"), {
      readRepository: () => "acme/demo",
    });
    expect(loaded.problems[0]?.at).toBe("<file>");
    expect(loaded.config.planDir).toBe("docs/planning");
    expect(loaded.present).toBe(true);
  });
});

describe("an unreadable overlay is present-with-a-problem, never absent", () => {
  const gh = { readRepository: () => "acme/demo" };

  test("a directory at the config path", async () => {
    const root = project(undefined);
    mkdirSync(join(root, ".agents/orchestration/config.yaml"), {
      recursive: true,
    });
    const loaded = await loadConfigFor(root, gh);
    expect(loaded.present).toBe(true);
    expect(loaded.problems.map((p) => p.at)).toContain("<file>");
    expect(loaded.problems[0]?.message).toContain("EISDIR");
  });

  test.skipIf(process.getuid?.() === 0)("a chmod 000 file", async () => {
    const root = project("repo: acme/demo\n");
    const file = join(root, ".agents/orchestration/config.yaml");
    chmodSync(file, 0o000);
    try {
      const loaded = await loadConfigFor(root, gh);
      expect(loaded.present).toBe(true);
      expect(loaded.problems[0]?.at).toBe("<file>");
      expect(loaded.problems[0]?.message).toContain("EACCES");
    } finally {
      chmodSync(file, 0o600);
    }
  });

  test("a genuinely missing file is still absent", async () => {
    const loaded = await loadConfigFor(project(undefined), gh);
    expect(loaded.present).toBe(false);
    expect(loaded.problems).toEqual([]);
  });
});

describe("A-30: loadConfigFor carries deprecations on every path", () => {
  const gh = { readRepository: () => "acme/demo" };
  const ALIAS = "opencodeServerUrl: http://127.0.0.1:4096\n";

  test("a present file with the deprecated alias hands the deprecation to the bin", async () => {
    const loaded = await loadConfigFor(project(ALIAS), gh);
    expect(loaded.deprecations.map((d) => d.at)).toEqual(["opencodeServerUrl"]);
    expect(loaded.problems).toEqual([]);
    // A deprecation does not make the file untrusted: the bins still act on it.
    expect(loaded.config.laneHosts.map((host) => host.name)).toEqual([
      "opencode-server",
    ]);
  });

  test("the file's own repo does not drop it", async () => {
    const loaded = await loadConfigFor(project(ALIAS + "repo: acme/own\n"), gh);
    expect(loaded.config.repo).toBe("acme/own");
    expect(loaded.deprecations).toHaveLength(1);
  });

  test("gh's repo does not drop it", async () => {
    expect((await loadConfigFor(project(ALIAS), gh)).deprecations).toHaveLength(
      1,
    );
  });

  test("a file that is not YAML has no config to deprecate, and says so plainly", async () => {
    const loaded = await loadConfigFor(project("planDir: [unclosed\n"), gh);
    expect(loaded.deprecations).toEqual([]);
  });

  test("an absent file has nothing to deprecate", async () => {
    expect((await loadConfigFor(project(undefined), gh)).deprecations).toEqual(
      [],
    );
  });
});
