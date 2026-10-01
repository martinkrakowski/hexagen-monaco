import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
 * resolved status port appearing in `forbiddenPorts`, a missing CI workflow, a
 * missing `gh`, a missing `yarn`, unavailable worktrees, and — for A-30 —
 * every lane-host row of §12.4 §7's doctor table.
 *
 * Each is asserted on the MESSAGE as well as the exit code, because a check
 * that fails without saying which file or which key is a check an operator
 * cannot act on.
 */

const HEALTHY: DoctorDeps = {
  exists: async () => true,
  hasCommand: async () => true,
  supportsWorktrees: async () => true,
  runCheck: async () => "ok",
  runRemote: async () => ({ status: "ok" as const, stdout: "lane@host" }),
  localUserEmail: async () => "lane@host",
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
    parsed.deprecations,
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

  test("a project with no laneHosts says nothing about lane hosts at all", async () => {
    let ran = false;
    const { code, findings, text } = await doctor("repo: owner/demo\n", {
      runCheck: async () => {
        ran = true;
        return "failed";
      },
      runRemote: async () => {
        ran = true;
        return { status: "failed", stdout: "" };
      },
    });
    expect(code).toBe(EXIT_HEALTHY);
    // Nothing was probed, because there is nothing to probe.
    expect(ran).toBe(false);
    expect(findings.some((f) => f.severity === "fail")).toBe(false);
    expect(findings.some((f) => f.check.startsWith("lane-host"))).toBe(false);
    expect(text).not.toContain("opencodeServerUrl");
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

describe("F4 — an overrides value that is not a list", () => {
  test.each([
    ["a mapping", "overrides:\n  invariant: eventDuty\n  reason: because\n"],
    ["null", "overrides:\n"],
    ["a string", "overrides: eventDuty\n"],
  ])("%s is a failure naming overrides", async (_label, yaml) => {
    const { code, findings } = await doctor(`repo: owner/demo\n${yaml}`);
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "config").message;
    expect(message).toMatch(/^overrides /);
    expect(message).toContain("must be a list");
  });
});

describe("F15 — an appendOnlyPaths that is not a regular expression", () => {
  test("is a failure naming appendOnlyPaths", async () => {
    const { code, findings } = await doctor(
      'repo: owner/demo\nappendOnlyPaths: "("\n',
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    expect(fails(findings, "config").message).toMatch(/^appendOnlyPaths /);
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
  test("F7: is a failure exiting 1, naming repo and the gh command that would derive it", async () => {
    const { code, findings } = await doctor("planDir: docs/planning\n");
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "repo").message;
    expect(message).toContain("repo");
    expect(message).toContain("gh repo view --json nameWithOwner");
  });

  test("F7: a repo the file did set is not reported missing", async () => {
    const { findings } = await doctor("repo: owner/demo\n");
    expect(findings.some((f) => f.check === "repo")).toBe(false);
  });

  test("F7: a malformed repo is reported once, by the schema, not twice", async () => {
    const { findings } = await doctor("repo: no-slash\n");
    expect(findings.some((f) => f.check === "repo")).toBe(false);
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

describe("A-32 — the CI workflow path is configurable", () => {
  test("a custom path that exists passes, and is the path asked about", async () => {
    const asked: string[] = [];
    const { findings } = await doctor(
      "repo: owner/demo\nciWorkflow: .github/workflows/sync-integrity.yml\n",
      {
        exists: async (path) => {
          asked.push(path);
          return path === ".github/workflows/sync-integrity.yml";
        },
      },
    );
    expect(findings.filter((f) => f.check === "ci-workflow")).toEqual([]);
    expect(asked).toContain(".github/workflows/sync-integrity.yml");
    expect(asked).not.toContain(".github/workflows/ci.yml");
  });

  test("a custom path that is missing fails, naming that path and not ci.yml", async () => {
    const { code, findings } = await doctor(
      "repo: owner/demo\nciWorkflow: .github/workflows/sync-integrity.yml\n",
      { exists: async (path) => path === ".github/workflows/ci.yml" },
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "ci-workflow").message;
    expect(message).toContain(".github/workflows/sync-integrity.yml");
    expect(message).not.toContain("ci.yml is missing");
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
    const result = await runDoctor(undefined, [], [], false, depsOver());
    expect(result.exitCode).toBe(EXIT_NO_CONFIG);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("hexagen-orchestration-init");
  });
});

/**
 * A-30 §3 and §12.4 §7's doctor table, driven through the seams.
 *
 * Every lane-host sub-check runs and is reported on its OWN. A host that is
 * missing its transport AND whose `check` fails must report both, because an
 * operator told about one of them fixes that one and runs the tool again to find
 * the other. Only the `user.email` read is ever skipped.
 */
const REMOTE_HOST = [
  "laneHosts:",
  "  - name: midnight",
  "    dispatch: [ocm-run]",
  "    gate: targeted-only",
  "    check: [ocm-run, --check]",
  "    ssh: m",
  "    clone: /srv/cf",
  "    worktrees: /srv/wt",
].join("\n");

const LOCAL_HOST = [
  "laneHosts:",
  "  - name: local-opencode",
  "    dispatch: [opencode, run]",
  "    check: [curl, -sf, http://127.0.0.1:4096/doc]",
  "    gate: full",
].join("\n");

const warns = (findings: readonly Finding[], check: string): Finding => {
  const found = findings.filter(
    (f) => f.severity === "warn" && f.check === check,
  );
  expect(
    found,
    `no warning named ${check} in:\n${findings.map((f) => f.message).join("\n")}`,
  ).toHaveLength(1);
  return found[0]!;
};

describe("A-30 §7: doctor on a lane host", () => {
  test("dispatch[0] absent from PATH is a FAIL on that host, and no other check runs away", async () => {
    const { code, findings } = await doctor(`repo: owner/demo\n${LOCAL_HOST}`, {
      hasCommand: async (c) => c !== "opencode",
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    const message = fails(findings, "lane-host local-opencode").message;
    expect(message).toContain("opencode");
    expect(message).toContain("not on PATH");
  });

  test("a host that fails BOTH PATH and check reports both", async () => {
    const { code, findings } = await doctor(`repo: owner/demo\n${LOCAL_HOST}`, {
      hasCommand: async (c) => c !== "opencode",
      runCheck: async () => "failed",
    });
    expect(code).toBe(EXIT_UNHEALTHY);
    const onThisHost = findings.filter(
      (f) => f.severity === "fail" && f.check === "lane-host local-opencode",
    );
    // Two failures, one host: the sub-checks do not stop at the first.
    expect(onThisHost).toHaveLength(2);
    const messages = onThisHost.map((f) => f.message).join("\n");
    expect(messages).toContain("not on PATH");
    expect(messages).toContain(
      'check ["curl","-sf","http://127.0.0.1:4096/doc"]',
    );
  });

  test("an ssh probe that is refused is a FAIL naming the alias and the probe", async () => {
    const { code, findings } = await doctor(
      `repo: owner/demo\n${REMOTE_HOST}\nseats:\n  - id: s\n    agent: lane\n    model: m\n    host: midnight\n`,
      { runRemote: async () => ({ status: "failed", stdout: "" }) },
    );
    expect(code).toBe(EXIT_UNHEALTHY);
    const onThisHost = findings.filter(
      (f) => f.check === "lane-host midnight" && f.severity === "fail",
    );
    const messages = onThisHost.map((f) => f.message).join("\n");
    expect(messages).toContain("ssh probe");
    expect(messages).toContain("BatchMode=yes");
    // The alias IN POSITION: a bare "m" is in the message's fixed text already.
    expect(messages).toContain("ConnectTimeout=5 m true");
  });

  test("ssh's own words ride on the probe FAIL, and on the email-read SKIP", async () => {
    const yaml = `repo: owner/demo\n${REMOTE_HOST}\nseats:\n  - id: s\n    agent: lane\n    model: m\n    host: midnight\n`;
    const refused = await doctor(yaml, {
      runRemote: async () => ({
        status: "failed",
        stdout: "",
        stderr: "Permission denied (publickey).",
      }),
    });
    expect(fails(refused.findings, "lane-host midnight").message).toContain(
      "ssh said: Permission denied (publickey).",
    );

    // The probe answers; the email read is what fails.
    let calls = 0;
    const skipped = await doctor(yaml, {
      runRemote: async () =>
        ++calls === 1
          ? { status: "ok" as const, stdout: "" }
          : {
              status: "failed" as const,
              stdout: "",
              stderr: "fatal: not a git repository",
            },
    });
    const skip = skipped.findings.find(
      (f) => f.severity === "skip" && f.message.includes("user.email"),
    );
    expect(skip?.message).toContain("ssh said: fatal: not a git repository");

    // Nothing said, nothing appended.
    const quiet = await doctor(yaml, {
      runRemote: async () => ({ status: "failed", stdout: "" }),
    });
    expect(fails(quiet.findings, "lane-host midnight").message).not.toContain(
      "ssh said",
    );
  });

  test("check: [/bin/false] is a FAIL, and check: [sleep, 30] is a FAIL naming the 10 s timeout", async () => {
    // The plan writes these as argv. In YAML a bare `false` and a bare `30` are
    // booleans and numbers, which is a `parseConfig` refusal, not a check that
    // fails — so the argv is written the way an overlay would write it.
    const failed = await doctor(
      `repo: owner/demo\n${LOCAL_HOST.replace(
        "[curl, -sf, http://127.0.0.1:4096/doc]",
        '["/bin/false"]',
      )}`,
      { runCheck: async () => "failed" },
    );
    expect(failed.code).toBe(EXIT_UNHEALTHY);
    expect(
      fails(failed.findings, "lane-host local-opencode").message,
    ).toContain("did not succeed");

    const timedOut = await doctor(
      `repo: owner/demo\n${LOCAL_HOST.replace(
        "[curl, -sf, http://127.0.0.1:4096/doc]",
        '[sleep, "30"]',
      )}`,
      { runCheck: async () => "timeout" },
    );
    expect(timedOut.code).toBe(EXIT_UNHEALTHY);
    const message = fails(
      timedOut.findings,
      "lane-host local-opencode",
    ).message;
    expect(message).toContain("10 s check timeout");
  });

  test("no check on a local host is a SKIP, and the run stays healthy", async () => {
    const yaml =
      "repo: owner/demo\nlaneHosts:\n  - name: here\n    dispatch: [opencode]\n    gate: full\n" +
      "seats:\n  - id: s\n    agent: lane\n    model: m\n    host: here\n";
    let checked = false;
    const { code, findings } = await doctor(yaml, {
      runCheck: async () => {
        checked = true;
        return "failed";
      },
    });
    expect(checked).toBe(false);
    const skip = findings.find(
      (f) => f.check === "lane-host here" && f.severity === "skip",
    );
    expect(skip?.message).toContain("declares no `check`");
    expect(code).toBe(EXIT_HEALTHY);
  });

  test("a clone email that differs is a WARN, and it never moves the exit code", async () => {
    const yaml = `repo: owner/demo\n${REMOTE_HOST}\nseats:\n  - id: s\n    agent: lane\n    model: m\n    host: midnight\n`;
    const { code, findings } = await doctor(yaml, {
      runRemote: async (_alias, argv) => ({
        status: "ok",
        stdout: argv.includes("config") ? "other@host" : "",
      }),
      localUserEmail: async () => "lane@here",
    });
    expect(code).toBe(EXIT_HEALTHY);
    const message = warns(findings, "lane-host midnight").message;
    expect(message).toContain("other@host");
    expect(message).toContain("Co-authored-by");
  });

  test("a clone email that MATCHES is silent", async () => {
    const yaml = `repo: owner/demo\n${REMOTE_HOST}\nseats:\n  - id: s\n    agent: lane\n    model: m\n    host: midnight\n`;
    const { code, findings } = await doctor(yaml, {
      runRemote: async () => ({ status: "ok", stdout: "lane@here" }),
      localUserEmail: async () => "lane@here",
    });
    expect(code).toBe(EXIT_HEALTHY);
    expect(
      findings.some(
        (f) => f.check === "lane-host midnight" && f.severity === "warn",
      ),
    ).toBe(false);
  });

  test("the email read is SKIPPED when the ssh probe failed, and is not attempted", async () => {
    const asked: string[][] = [];
    const { findings } = await doctor(`repo: owner/demo\n${REMOTE_HOST}`, {
      runRemote: async (_alias, argv) => {
        asked.push([...argv]);
        return { status: "failed", stdout: "" };
      },
    });
    // Two probes were not two: only the ssh probe ran.
    expect(asked).toEqual([["true"]]);
    const skip = findings.find(
      (f) =>
        f.check === "lane-host midnight" &&
        f.severity === "skip" &&
        f.message.includes("user.email"),
    );
    expect(skip?.message).toContain("ssh probe failed");
  });

  test("a host no seat references is a WARN, and the host itself is not failed for it", async () => {
    const { code, findings } = await doctor(`repo: owner/demo\n${LOCAL_HOST}`);
    expect(code).toBe(EXIT_HEALTHY);
    expect(warns(findings, "lane-host local-opencode").message).toContain(
      "no seat dispatches through this host",
    );
  });

  test("a seat that names the host silences that WARN", async () => {
    const { code, findings } = await doctor(
      `repo: owner/demo\n${LOCAL_HOST}\nseats:\n  - id: local-seat\n    agent: lane\n    model: m\n    host: local-opencode\n`,
    );
    expect(code).toBe(EXIT_HEALTHY);
    expect(findings.some((f) => f.severity === "warn")).toBe(false);
  });

  test("the order is PATH, ssh, check, email, then the unreferenced WARN", async () => {
    const order: string[] = [];
    await doctor(`repo: owner/demo\n${REMOTE_HOST}`, {
      hasCommand: async (c) => {
        if (c === "ocm-run") order.push("path");
        return true;
      },
      runRemote: async (_alias, argv) => {
        order.push(argv.includes("config") ? "email" : "ssh");
        return { status: "ok", stdout: "lane@here" };
      },
      runCheck: async () => {
        order.push("check");
        return "ok";
      },
    });
    expect(order).toEqual(["path", "ssh", "check", "email"]);
  });
});

describe("A-30 §1.3: the deprecated alias in doctor", () => {
  test("opencodeServerUrl set gives the synthesized host plus a WARN, and never a FAIL", async () => {
    const checked: string[][] = [];
    const { code, findings, text } = await doctor(
      "repo: owner/demo\nopencodeServerUrl: http://127.0.0.1:4096\n",
      {
        runCheck: async (argv) => {
          checked.push([...argv]);
          return "ok";
        },
      },
    );
    expect(code).toBe(EXIT_HEALTHY);
    // TWO warns: the deprecation, and the synthesized host no seat names.
    const warned = findings.filter((f) => f.severity === "warn");
    expect(warned).toHaveLength(2);
    expect(warned.filter((f) => f.check === "config")[0]?.message).toContain(
      "opencodeServerUrl is deprecated",
    );
    expect(
      warned.filter((f) => f.check === "lane-host opencode-server")[0]?.message,
    ).toContain("no seat dispatches through this host");
    // It replaced the old HTTP probe: the synthesized host's `check` runs, and
    // nothing else is probed.
    expect(checked).toEqual([["curl", "-sf", "http://127.0.0.1:4096/doc"]]);
    expect(text).toContain("WARN");
    expect(text).toContain("warning(s) that do not affect this exit code");
  });

  test("a deprecation is a WARN in the report and never a FAIL line", async () => {
    const { text } = await doctor(
      "repo: owner/demo\nopencodeServerUrl: http://127.0.0.1:4096\n",
    );
    expect(text).toContain("WARN  [config] opencodeServerUrl is deprecated");
    expect(text).not.toContain("FAIL  [config] opencodeServerUrl");
  });
});

/**
 * OW1's migrated fixture overlay, run through doctor.
 *
 * This is the exact set OW8's seeded run asserts, and it is pinned here because
 * a WARN nobody asserts is a WARN that silently grows: adding a seat to the
 * fixture would change what a CI runner is expected to report, and the only
 * place that can be caught is a test that names the whole set.
 */
const FIXTURE = resolve(
  import.meta.dirname,
  "../../../../packages/template-engine/__tests__/fixtures/orchestration/campaign-foundry/overlay/config.yaml",
);

describe("A-30 §6: doctor's findings on OW1's fixture overlay", () => {
  test("it is exactly one WARN, for local-opencode, and nothing else", async () => {
    const parsed = parseConfig(readFileSync(FIXTURE, "utf8"));
    expect(parsed.problems).toEqual([]);

    const { findings } = await runDoctor(
      parsed.config,
      parsed.problems,
      parsed.deprecations,
      true,
      depsOver(),
    );
    const warned = findings.filter((f) => f.severity === "warn");
    expect(warned).toHaveLength(1);
    expect(warned[0]?.check).toBe("lane-host local-opencode");
    expect(warned[0]?.message).toContain(
      "no seat dispatches through this host",
    );
    // With every capability present, the fixture is healthy.
    expect(findings.filter((f) => f.severity === "fail")).toEqual([]);
  });

  test("on a CI runner the ONLY findings are the two local-opencode FAILs and that one WARN", async () => {
    const parsed = parseConfig(readFileSync(FIXTURE, "utf8"));
    const { findings, exitCode } = await runDoctor(
      parsed.config,
      parsed.problems,
      parsed.deprecations,
      true,
      {
        ...HEALTHY,
        // `opencode` is not installed on a runner, and `curl` cannot reach a
        // server nobody started. Both are on ONE host, so both must appear.
        hasCommand: async (command) => command !== "opencode",
        runCheck: async () => "failed",
      },
    );
    const failed = findings.filter((f) => f.severity === "fail");
    expect(
      failed.map((f) => f.check),
      "two failures, both on the one host the fixture declares",
    ).toEqual(["lane-host local-opencode", "lane-host local-opencode"]);
    const messages = failed.map((f) => f.message).join("\n");
    expect(messages).toContain("dispatch[0] (opencode) is not on PATH");
    expect(messages).toContain(
      'check ["curl","-sf","http://127.0.0.1:4096/doc"]',
    );
    expect(findings.filter((f) => f.severity === "warn")).toHaveLength(1);
    expect(exitCode).toBe(EXIT_UNHEALTHY);
  });
});

describe("HEXAGEN_GATE_SLOTS is printed as INFO", () => {
  const yaml = "repo: owner/demo\n";
  const slots = (value: string | undefined) => ({ gateSlots: () => value });

  test("a value the lock accepts is shown as INFO and never moves the exit code or the counters", async () => {
    const { code, findings, text } = await doctor(yaml, slots("4"));
    expect(code).toBe(EXIT_HEALTHY);
    const info = findings.filter((f) => f.severity === "info");
    expect(info).toHaveLength(1);
    expect(info[0]!.check).toBe("gate-slots");
    expect(text).toMatch(/^INFO {2}\[gate-slots\] HEXAGEN_GATE_SLOTS=4:/m);
    // INFO is neither a problem nor a warning.
    expect(text).toContain("doctor: OK.");
    expect(text).not.toContain("warning(s)");
  });

  test("an unset variable says the default of 1 slot", async () => {
    const { text } = await doctor(yaml, slots(undefined));
    expect(text).toContain("HEXAGEN_GATE_SLOTS is unset");
    expect(text).toContain("1 slot");
  });

  test("a value the lock would refuse is a FAIL: named, every gate will refuse, exit non-zero, never OK", async () => {
    for (const bad of ["0", "65", "abc", "", "07"]) {
      const { code, findings, text } = await doctor(yaml, slots(bad));
      expect(code, bad).toBe(EXIT_UNHEALTHY);
      expect(fails(findings, "gate-slots").message).toContain(
        `HEXAGEN_GATE_SLOTS=${JSON.stringify(bad)}`,
      );
      expect(text).toContain("every gate");
      expect(text).toContain("will refuse");
      expect(text).not.toContain("doctor: OK");
      expect(text).toContain("problem(s) to fix");
    }
  });

  test("a caller that supplies no environment gets no line at all", async () => {
    const { findings } = await doctor(yaml);
    expect(findings.some((f) => f.check === "gate-slots")).toBe(false);
  });
});
