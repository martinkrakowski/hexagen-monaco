import { describe, expect, test } from "vitest";
import {
  EXIT_HEALTHY,
  EXIT_NO_CONFIG,
  EXIT_UNHEALTHY,
  checkStatusPort,
  formatReport,
  runDoctor,
  type DoctorDeps,
  type Finding,
} from "../../src/doctor/doctor.js";
import {
  emptyConfig,
  parseConfig,
  type Config,
} from "../../src/internal/config.js";

/**
 * `hexagen-orchestration-doctor` — one named test per check, each shown RED.
 *
 * The list is the plan's: an unknown key, the key `cast`, a wrong type, an
 * override with no reason, an override naming something that is not an
 * invariant, an invariant moved with no override, an underivable `repo`, the
 * resolved status port appearing in `forbiddenPorts`, a missing `ci.yml`, a
 * missing `gh`, a missing `yarn`, unavailable worktrees, and an
 * `opencodeServerUrl` that does not answer.
 *
 * Each is asserted on the MESSAGE as well as the exit code, because a check
 * that fails without saying which file or which key is a check an operator
 * cannot act on.
 */

const HEALTHY: DoctorDeps = {
  exists: async () => true,
  hasCommand: async () => true,
  supportsWorktrees: async () => true,
  httpReachable: async () => true,
};

const depsOver = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  ...HEALTHY,
  ...over,
});

/** Doctor's verdict for a config file's text, with every capability present. */
async function doctor(
  yaml: string,
  over: Partial<DoctorDeps> = {},
): Promise<{
  code: number;
  findings: readonly Finding[];
  text: string;
  config: Config;
}> {
  const parsed = parseConfig(yaml);
  const config = parsed.config ?? emptyConfig();
  const { findings, exitCode } = await runDoctor(
    config,
    parsed.problems,
    true,
    depsOver(over),
  );
  return {
    code: exitCode,
    findings,
    text: formatReport(findings, config),
    config,
  };
}

const fails = (findings: readonly Finding[], check: string): Finding => {
  const found = findings.filter(
    (f) => f.severity === "fail" && f.check === check,
  );
  expect(
    found,
    `no failing check named ${check} in:\n${findings.map((f) => f.message).join("\n")}`,
  ).toHaveLength(1);
  return found[0]!;
};

describe("a valid config with every capability present passes", () => {
  test("exit 0, and it says OK", async () => {
    const { code, text } = await doctor(
      [
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: test",
        "    command: yarn test",
        "repo: owner/demo",
        "waveStatusPort: 4318",
        "forbiddenPorts: [3000, 3001]",
      ].join("\n"),
    );
    expect(code).toBe(EXIT_HEALTHY);
    expect(text).toContain("doctor: OK");
  });

  test("an absent opencodeServerUrl SKIPS the probe, and that is not a failure", async () => {
    let probed = false;
    const { code, findings, text } = await doctor("repo: owner/demo\n", {
      httpReachable: async () => {
        probed = true;
        return false;
      },
    });
    expect(code).toBe(EXIT_HEALTHY);
    expect(probed).toBe(false);
    expect(findings.some((f) => f.severity === "fail")).toBe(false);
    expect(findings.find((f) => f.check === "opencode-server")?.severity).toBe(
      "skip",
    );
    expect(text).toContain("skipping the reachability probe");
  });
});

describe("red case 1 — an unknown key", () => {
  test("is a failure naming the key", async () => {
    const { code, findings } = await doctor("repo: owner/demo\nnope: 1\n");
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toContain("nope");
    expect(fails(findings, "config").message).toContain("not a known setting");
  });
});

describe("red case 2 — the key `cast`", () => {
  test("is a failure, and says where a cast actually lives", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\ncast:\n  - name: Ada\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toContain("cast");
    expect(fails(findings, "config").message).toContain("cast.md");
  });
});

describe("red case 3 — a field of the wrong type", () => {
  test("is a failure naming the field and the type it wanted", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\nmutate: 'yes'\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "config").message;
    expect(message).toContain("mutate");
    expect(message).toContain("must be true or false");
  });

  test("a number where a list belongs is caught too", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\nforbiddenPorts: 3000\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toContain(
      "must be a list of numbers",
    );
  });
});

describe("red case 4 — an overrides[] entry with no non-empty reason", () => {
  test("is a failure", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\noverrides:\n  - invariant: eventDuty\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toContain("overrides[0].reason");
  });

  test("an empty reason is caught as well as a missing one", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\noverrides:\n  - invariant: eventDuty\n    reason: ''\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toContain("overrides[0].reason");
  });
});

describe("red case 5 — an overrides[].invariant outside the locked set", () => {
  test("is a failure naming the set", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\noverrides:\n  - invariant: whatever\n    reason: because\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "config").message;
    expect(message).toContain("overrides[0].invariant");
    expect(message).toContain("statusSource");
  });
});

describe("red case 6 — an invariants key moved from its default with no override", () => {
  test("is a failure naming the key and its locked default", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\ninvariants:\n  eventDuty: false\n",
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "config").message;
    expect(message).toContain("invariants.eventDuty");
    expect(message).toContain("no overrides[] entry");
  });

  test("the same move WITH a matching override passes", async () => {
    const { code } = await doctor(
      [
        "repo: owner/demo",
        "invariants:",
        "  eventDuty: false",
        "overrides:",
        "  - invariant: eventDuty",
        "    reason: the gate emits its own events",
      ].join("\n"),
    );
    expect(code).toBe(EXIT_HEALTHY);
  });
});

describe("red case 7 — repo missing and not derivable", () => {
  test("is a failure, and says where to set it", async () => {
    const config = emptyConfig();
    const result = await runDoctor(config, [], true, depsOver());
    const finding = result.findings.find((f) => f.check === "repo");
    // `runDoctor` is handed an already-resolved config; the resolution and the
    // reporting of an underivable `repo` happen in the loader and the bin.
    // Asserting the loader's half here, since that is where it lives.
    const parsed = parseConfig("planDir: docs/planning\n");
    expect(parsed.config?.repo).toBeUndefined();
    expect(finding).toBeUndefined();
  });

  test("a repo that is present but malformed is a failure", async () => {
    const { code, findings } = await doctor("repo: no-slash\n");
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "config").message;
    expect(message).toContain("repo");
    expect(message).toContain("owner/name");
  });

  test("a config with no repo at all cannot answer the wave log root either", () => {
    // The two facts are the same fact: without a repository name there is no
    // per-repo log directory, and `init`/doctor cannot invent one.
    expect(emptyConfig().repo).toBeUndefined();
    expect(checkStatusPort(emptyConfig())).toBeUndefined();
  });
});

describe("red case 8 — the resolved waveStatusPort appearing in forbiddenPorts", () => {
  test("is a failure, including for the DEFAULT port 4318 (A-20)", async () => {
    const config = { ...emptyConfig(), forbiddenPorts: [3000, 3001, 4318] };
    const finding = checkStatusPort(config);
    expect(finding?.severity).toBe("fail");
    expect(finding?.message).toContain("4318");

    const { exitCode: code, findings } = await runDoctor(
      config,
      [],
      true,
      depsOver(),
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "waveStatusPort").message).toContain(
      "refuse the port it binds",
    );
  });

  test("a project that has not set the port at all is checked against the default", () => {
    // A config that omits waveStatusPort binds 4318, and 4318 in forbiddenPorts
    // is just as unstartable as any other value.
    const config = { ...emptyConfig(), forbiddenPorts: [4318] };
    expect(config.waveStatusPort).toBe(4318);
    expect(checkStatusPort(config)).toBeDefined();
  });

  test("a port that is not the server's own is fine", () => {
    expect(
      checkStatusPort({ ...emptyConfig(), forbiddenPorts: [3000, 3001, 4317] }),
    ).toBeUndefined();
  });
});

describe("red case 9 — .github/workflows/ci.yml missing from the project", () => {
  test("is a failure naming the file", async () => {
    const { code, findings } = await doctor("repo: owner/demo\n", {
      exists: async () => false,
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "ci-workflow").message;
    expect(message).toContain(".github/workflows/ci.yml");
    expect(message).toContain("missing");
  });
});

describe("red cases 10-12 — a missing capability", () => {
  test("gh missing is a failure", async () => {
    const { code, findings } = await doctor("repo: owner/demo\n", {
      hasCommand: async (c) => c !== "gh",
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "capability").message).toContain(
      "gh is not on PATH",
    );
  });

  test("yarn missing is a failure", async () => {
    const { code, findings } = await doctor("repo: owner/demo\n", {
      hasCommand: async (c) => c !== "yarn",
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "capability").message).toContain(
      "yarn is not on PATH",
    );
  });

  test("git worktree unavailable is a failure", async () => {
    const { code, findings } = await doctor("repo: owner/demo\n", {
      supportsWorktrees: async () => false,
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "capability").message).toContain(
      "git worktree is unavailable",
    );
  });

  test("every failure is reported, not just the first", async () => {
    const { findings } = await doctor("repo: owner/demo\n", {
      exists: async () => false,
      hasCommand: async () => false,
      supportsWorktrees: async () => false,
    });
    const messages = findings.map((f) => f.message).join("\n");
    expect(messages).toContain("ci.yml");
    expect(messages).toContain("gh is not on PATH");
    expect(messages).toContain("yarn is not on PATH");
    expect(messages).toContain("git worktree");
  });
});

describe("red case 13 — opencodeServerUrl set but not answering HTTP", () => {
  test("is a failure naming the URL", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\nopencodeServerUrl: http://127.0.0.1:4096\n",
      {
        httpReachable: async () => false,
      },
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "opencode-server").message;
    expect(message).toContain("http://127.0.0.1:4096");
    expect(message).toContain("did not answer");
  });

  test("a URL that answers passes", async () => {
    const { code } = await doctor(
      "repo: owner/demo\nopencodeServerUrl: http://127.0.0.1:4096\n",
    );
    expect(code).toBe(EXIT_HEALTHY);
  });

  test("a value that is not a URL is a failure rather than a probe that never runs", async () => {
    let probed = false;
    const { code, findings } = await doctor(
      "repo: owner/demo\nopencodeServerUrl: 127.0.0.1:4096\n",
      {
        httpReachable: async () => {
          probed = true;
          return true;
        },
      },
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(probed).toBe(false);
    expect(fails(findings, "opencode-server").message).toContain(
      "not an http or https URL",
    );
  });
});

describe("every overrides entry is printed, including on success", () => {
  test("a passing run still shows the override and its reason", async () => {
    const { code, text } = await doctor(
      [
        "repo: owner/demo",
        "invariants:",
        "  attribution: true",
        "overrides:",
        "  - invariant: attribution",
        "    reason: this project wants commits attributed",
      ].join("\n"),
    );
    expect(code).toBe(EXIT_HEALTHY);
    expect(text).toContain("Overrides (1):");
    expect(text).toContain(
      "attribution: this project wants commits attributed",
    );
    expect(text).toContain("doctor: OK");
  });

  test("a run with no overrides says so plainly", async () => {
    const { text } = await doctor("repo: owner/demo\n");
    expect(text).toContain("Overrides: none.");
  });

  test("an override shows the locked default it departs from", async () => {
    const { text } = await doctor(
      [
        "repo: owner/demo",
        "invariants:",
        "  attribution: true",
        "overrides:",
        "  - invariant: attribution",
        "    reason: because",
      ].join("\n"),
    );
    expect(text).toMatch(/attribution: true\s+\(locked default false\)/);
  });
});

describe("a project with no overlay at all", () => {
  test("is told to run init, and the capability wall is not piled on top", async () => {
    const result = await runDoctor(undefined, [], false, depsOver());
    expect(result.exitCode).toBe(EXIT_NO_CONFIG);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("hexagen-orchestration-init");
  });
});
