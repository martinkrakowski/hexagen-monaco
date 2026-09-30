import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  SYNTHESIZED_HOST_NAME,
  parseLaneHosts,
} from "../../src/internal/lane-hosts.js";
import { parseConfig } from "../../src/internal/config.js";
import { configRefusal } from "../../src/internal/refusal.js";

/**
 * `laneHosts` and `seats` (A-30 §1, and §12.4 §7's `parseConfig` table).
 *
 * A lane host is where a delegated lane's tools actually RUN, so this schema is
 * stricter than `gateSteps[i]`: an unknown key inside an entry is a problem
 * naming the key, because a key nothing reads is a key the author believed was
 * obeyed. Each red case below is the plan's own table, asserted at the path the
 * plan names — a refusal an operator cannot locate is a refusal they will fix by
 * deleting the file.
 */

/** A valid remote host, so each case can change exactly one thing. */
const REMOTE = [
  "laneHosts:",
  "  - name: midnight",
  "    dispatch: [ocm-run]",
  "    gate: targeted-only",
  "    check: [ocm-run, --check]",
  "    ssh: m",
  "    clone: /srv/cf",
  "    worktrees: /srv/wt",
].join("\n");

/** A valid local host: no ssh, no clone, no worktrees. */
const LOCAL = [
  "laneHosts:",
  "  - name: local-opencode",
  "    dispatch: [opencode, run, --attach, http://127.0.0.1:4096]",
  "    check: [curl, -sf, http://127.0.0.1:4096/doc]",
  "    gate: full",
].join("\n");

const SEAT = [
  "seats:",
  "  - id: space-bunny",
  "    agent: lane",
  "    model: openrouter/stealth/space-bunny-alpha",
  "    host: midnight",
].join("\n");

const problemsAt = (yaml: string): readonly string[] =>
  parseConfig(yaml).problems.map((problem) => problem.at);

describe("A-30 §7: every parseConfig red case, at the path the plan names", () => {
  test("a remote host without ssh names ssh", () => {
    const yaml = REMOTE.replace("    ssh: m\n", "");
    expect(problemsAt(yaml)).toContain("laneHosts[0].ssh");
  });

  test("a remote host without clone/worktrees names them, and names ssh as the broken promise", () => {
    const yaml = [
      "laneHosts:",
      "  - name: midnight",
      "    dispatch: [ocm-run]",
      "    gate: targeted-only",
      "    check: [ocm-run, --check]",
      "    ssh: m",
    ].join("\n");
    expect(problemsAt(yaml)).toEqual(
      expect.arrayContaining([
        "laneHosts[0].clone",
        "laneHosts[0].worktrees",
        "laneHosts[0].ssh",
      ]),
    );
  });

  test("a host carrying clone but no ssh names ssh", () => {
    const yaml = REMOTE.replace("    ssh: m\n", "").replace(
      "    worktrees: /srv/wt",
      "    worktrees: /srv/wt",
    );
    expect(problemsAt(yaml)).toContain("laneHosts[0].ssh");
  });

  test("ssh plus clone with no worktrees names worktrees only: ssh did not break its promise", () => {
    const yaml = REMOTE.replace("\n    worktrees: /srv/wt", "");
    expect(problemsAt(yaml)).toEqual(["laneHosts[0].worktrees"]);
  });

  test("a remote host without check names check", () => {
    const yaml = REMOTE.replace("    check: [ocm-run, --check]\n", "");
    expect(problemsAt(yaml)).toContain("laneHosts[0].check");
  });

  test("a local host that carries ssh is refused at ssh", () => {
    // `ssh` is the key that PROMISED a remote host, so the broken promise is
    // reported there rather than only on the keys it failed to bring with it.
    const yaml = LOCAL.replace("    gate: full", "    gate: full\n    ssh: m");
    expect(problemsAt(yaml)).toContain("laneHosts[0].ssh");
  });

  test("an ssh alias with a leading dash, or a bad character, is refused at ssh", () => {
    for (const alias of ["-oProxyCommand=x", "has space", "semi;colon"]) {
      expect(
        problemsAt(REMOTE.replace("ssh: m", `ssh: ${JSON.stringify(alias)}`)),
        alias,
      ).toContain("laneHosts[0].ssh");
    }
  });

  test("a dispatch that is not a list, or is empty, is refused at dispatch", () => {
    expect(
      problemsAt(REMOTE.replace("dispatch: [ocm-run]", "dispatch: ocm-run")),
    ).toContain("laneHosts[0].dispatch");
    expect(
      problemsAt(REMOTE.replace("dispatch: [ocm-run]", "dispatch: []")),
    ).toContain("laneHosts[0].dispatch");
    expect(
      problemsAt(REMOTE.replace("    dispatch: [ocm-run]\n", "")),
    ).toContain("laneHosts[0].dispatch");
  });

  test("a dispatch carrying a flag the orchestrator appends is refused at dispatch", () => {
    for (const flag of [
      "--dir",
      "--agent",
      "-m",
      "--model",
      "--format",
      "--model=x",
      "--dir=/tmp",
      "--agent=lane",
      "--format=json",
    ]) {
      const yaml = REMOTE.replace(
        "dispatch: [ocm-run]",
        `dispatch: [ocm-run, ${flag}]`,
      );
      expect(problemsAt(yaml), flag).toContain("laneHosts[0].dispatch");
    }
  });

  test("a relative clone or worktrees is refused at that key", () => {
    expect(
      problemsAt(REMOTE.replace("clone: /srv/cf", "clone: srv/cf")),
    ).toContain("laneHosts[0].clone");
    expect(
      problemsAt(REMOTE.replace("worktrees: /srv/wt", "worktrees: ./wt")),
    ).toContain("laneHosts[0].worktrees");
  });

  test("a duplicate laneHosts[].name is refused at the LATER name", () => {
    // ONE `laneHosts:` key with two entries: a second key would be a YAML
    // duplicate key, which is a different defect with a different path.
    const yaml = [
      "laneHosts:",
      "  - name: midnight",
      "    dispatch: [ocm-run]",
      "    gate: full",
      "  - name: midnight",
      "    dispatch: [opencode, run]",
      "    gate: full",
    ].join("\n");
    const duplicate = parseConfig(yaml).problems.find(
      (p) => p.at === "laneHosts[1].name",
    );
    expect(duplicate, "the SECOND name is the duplicate").toBeDefined();
    expect(duplicate?.message).toContain("laneHosts[0]");
  });

  test("a duplicate seats[].id is refused at the LATER id", () => {
    const yaml = [
      REMOTE,
      "seats:",
      "  - id: space-bunny",
      "    agent: lane",
      "    model: one",
      "    host: midnight",
      "  - id: space-bunny",
      "    agent: lane-glm",
      "    model: two",
      "    host: midnight",
    ].join("\n");
    expect(problemsAt(yaml)).toContain("seats[1].id");
  });

  test("a seats[].host naming no host is refused at that seat's host", () => {
    expect(
      problemsAt(
        `${REMOTE}\n${SEAT.replace("host: midnight", "host: nowhere")}`,
      ),
    ).toContain("seats[0].host");
  });

  test("gate: partial is refused at gate", () => {
    expect(
      problemsAt(REMOTE.replace("gate: targeted-only", "gate: partial")),
    ).toContain("laneHosts[0].gate");
  });

  test('laneHosts: {} is refused as "must be a list", at laneHosts', () => {
    expect(problemsAt("laneHosts: {}\n")).toEqual(["laneHosts"]);
    expect(parseConfig("laneHosts: {}\n").problems[0].message).toContain(
      "must be a list",
    );
  });

  test("seats: {} is refused the same way", () => {
    expect(problemsAt("seats: {}\n")).toEqual(["seats"]);
  });
});

describe("A-30 §7: the required-ness and the unknown keys", () => {
  test("name, dispatch and gate are each required", () => {
    for (const [missing, yaml] of [
      ["name", "laneHosts:\n  - dispatch: [opencode]\n    gate: full\n"],
      ["dispatch", "laneHosts:\n  - name: local\n    gate: full\n"],
      ["gate", "laneHosts:\n  - name: local\n    dispatch: [opencode]\n"],
    ] as const) {
      const result = parseConfig(yaml);
      expect(
        result.problems.map((p) => p.at),
        yaml,
      ).toEqual([`laneHosts[0].${missing}`]);
      // A host missing what makes it nameable is not dispatched through.
      expect(result.config?.laneHosts).toEqual([]);
    }
  });

  test("an unknown key in a lane host is a problem naming it", () => {
    const yaml = LOCAL.replace(
      "    gate: full",
      "    gate: full\n    probe: true",
    );
    expect(problemsAt(yaml)).toEqual(["laneHosts[0].probe"]);
  });

  test("an unknown key in a seat is a problem naming it", () => {
    const yaml = `${REMOTE}\n${SEAT.replace("    agent: lane", "    agent: lane\n    sandbox: true")}`;
    expect(problemsAt(yaml)).toEqual(["seats[0].sandbox"]);
  });

  test("a name that is not a token is refused, and so is a seat id that is not one", () => {
    expect(
      problemsAt(LOCAL.replace("name: local-opencode", "name: Local_1")),
    ).toContain("laneHosts[0].name");
    expect(
      problemsAt(
        `${REMOTE}\n${SEAT.replace("id: space-bunny", "id: Space Bunny")}`,
      ),
    ).toContain("seats[0].id");
  });

  test("install on a LOCAL host is refused at install", () => {
    const yaml = LOCAL.replace(
      "    gate: full",
      "    gate: full\n    install: [yarn, install]",
    );
    expect(problemsAt(yaml)).toEqual(["laneHosts[0].install"]);
  });

  test("install on a remote host is accepted, because it is the recommended answer to N4", () => {
    const yaml = REMOTE.replace(
      "    clone: /srv/cf",
      "    clone: /srv/cf\n    install: [env, PATH=/usr/bin, YARN_NM_MODE=classic, yarn, install, --immutable]",
    );
    expect(problemsAt(yaml)).toEqual([]);
  });

  test("usage is optional and doctor never runs it", () => {
    const yaml = REMOTE.replace(
      "    gate: targeted-only",
      "    gate: targeted-only\n    usage: [lane-usage, --host, m]",
    );
    expect(problemsAt(yaml)).toEqual([]);
    expect(parseConfig(yaml).config?.laneHosts[0]?.usage).toEqual([
      "lane-usage",
      "--host",
      "m",
    ]);
  });
});

describe("A-30 §7: what a valid overlay parses into", () => {
  test("a valid remote host plus two seats parses clean", () => {
    const yaml = [
      REMOTE,
      "seats:",
      "  - id: space-bunny",
      "    agent: lane",
      "    model: openrouter/stealth/space-bunny-alpha",
      "    host: midnight",
      "  - id: glm-flash",
      "    agent: lane-glm",
      "    model: openrouter/z-ai/glm-5.3-flash",
      "    host: midnight",
    ].join("\n");
    const result = parseConfig(yaml);
    expect(result.problems).toEqual([]);
    expect(result.deprecations).toEqual([]);
    expect(result.config?.laneHosts).toEqual([
      {
        name: "midnight",
        dispatch: ["ocm-run"],
        gate: "targeted-only",
        check: ["ocm-run", "--check"],
        ssh: "m",
        clone: "/srv/cf",
        worktrees: "/srv/wt",
      },
    ]);
    expect(result.config?.seats.map((seat) => seat.id)).toEqual([
      "space-bunny",
      "glm-flash",
    ]);
  });

  test("a valid local host parses clean, and no check is required on it", () => {
    const yaml =
      "laneHosts:\n  - name: here\n    dispatch: [opencode, run]\n    gate: full\n";
    const result = parseConfig(yaml);
    expect(result.problems).toEqual([]);
    expect(result.config?.laneHosts).toEqual([
      { name: "here", dispatch: ["opencode", "run"], gate: "full" },
    ]);
  });

  test("a host that failed validation is dropped, so nothing dispatches through a typo", () => {
    const yaml = LOCAL.replace("gate: full", "gate: partial");
    expect(parseConfig(yaml).config?.laneHosts).toEqual([]);
  });

  test("a host dropped for a bad gate still holds its name: a seat naming it is not also a dangling reference", () => {
    const yaml = [
      LOCAL.replace("gate: full", "gate: partial"),
      "seats:",
      "  - id: s1",
      "    agent: lane",
      "    model: m",
      "    host: local-opencode",
    ].join("\n");
    const result = parseConfig(yaml);
    expect(result.config?.laneHosts).toEqual([]);
    expect(result.problems.map((p) => p.at)).toEqual(["laneHosts[0].gate"]);
  });

  test("a host dropped for a bad dispatch still holds its name, so a later duplicate is caught", () => {
    const yaml = [
      "laneHosts:",
      "  - name: dup",
      "    dispatch: []",
      "    gate: full",
      "  - name: dup",
      "    dispatch: [opencode, run]",
      "    gate: full",
    ].join("\n");
    const at = problemsAt(yaml);
    expect(at).toContain("laneHosts[0].dispatch");
    expect(at).toContain("laneHosts[1].name");
  });

  test("a host dropped for a bad gate still collides with the synthesized opencode-server", () => {
    const yaml = [
      "opencodeServerUrl: http://127.0.0.1:4096",
      "laneHosts:",
      `  - name: ${SYNTHESIZED_HOST_NAME}`,
      "    dispatch: [opencode, run]",
      "    gate: partial",
    ].join("\n");
    const result = parseConfig(yaml);
    expect(result.problems.map((p) => p.at)).toContain("laneHosts[0].name");
    // The declared host wins the name even though it was dropped, so the
    // synthesized one is not added beside it: the file has to be fixed first.
    expect(result.config?.laneHosts).toEqual([]);
  });

  test("a host kept with one refused optional key is still reported on by doctor", () => {
    // `clone` is present, so the host is remote, so a missing `ssh` is a problem
    // — and the host survives, because doctor still has to walk it.
    const yaml = LOCAL.replace(
      "    gate: full",
      "    gate: full\n    clone: srv/cf",
    );
    const result = parseConfig(yaml);
    expect(result.problems.map((p) => p.at)).toContain("laneHosts[0].clone");
    expect(result.config?.laneHosts).toHaveLength(1);
  });

  test("parseLaneHosts is the one implementation, and defaults both lists to []", () => {
    expect(parseLaneHosts(undefined, undefined, undefined)).toEqual({
      hosts: [],
      seats: [],
      problems: [],
      deprecations: [],
    });
  });
});

describe("A-30 §1.3: the deprecated alias synthesizes a host and never refuses", () => {
  const ALIAS = "repo: acme/demo\nopencodeServerUrl: http://127.0.0.1:4096\n";

  test("it yields the synthesized host, a deprecation, and no problem", () => {
    const result = parseConfig(ALIAS);
    expect(result.problems).toEqual([]);
    expect(result.config?.laneHosts).toEqual([
      {
        name: SYNTHESIZED_HOST_NAME,
        dispatch: ["opencode", "run", "--attach", "http://127.0.0.1:4096"],
        gate: "full",
        check: ["curl", "-sf", "http://127.0.0.1:4096/doc"],
      },
    ]);
    expect(result.deprecations).toHaveLength(1);
    expect(result.deprecations[0].at).toBe("opencodeServerUrl");
    expect(result.deprecations[0].message).toContain("laneHosts");
  });

  test("the alias is not a config field, so nothing downstream reads it", () => {
    expect(parseConfig(ALIAS).config).not.toHaveProperty("opencodeServerUrl");
  });

  test("a deprecation NEVER refuses: configRefusal does not see it", () => {
    const parsed = parseConfig(ALIAS);
    expect(
      configRefusal("init", "scaffold", {
        present: true,
        problems: parsed.problems,
      }),
    ).toBeUndefined();
    // And the shape a bin actually holds — a whole loaded result, deprecations
    // and all — refuses nothing either.
    const loaded = {
      present: true,
      problems: parsed.problems,
      deprecations: parsed.deprecations,
    };
    expect(configRefusal("init", "scaffold", loaded)).toBeUndefined();
  });

  test("a name collision is a problem at the DECLARING entry's name", () => {
    const yaml = [
      "repo: acme/demo",
      "opencodeServerUrl: http://127.0.0.1:4096",
      LOCAL.replace("local-opencode", SYNTHESIZED_HOST_NAME),
    ].join("\n");
    const result = parseConfig(yaml);
    const collision = result.problems.find((p) => p.at.endsWith(".name"));
    expect(collision?.at).toBe("laneHosts[0].name");
    expect(collision?.message).toContain(
      "collides with the host synthesized from `opencodeServerUrl`",
    );
    // The DECLARED host wins: two entries with one name would make
    // `seats[].host` ambiguous, which is no better than naming nothing.
    expect(result.config?.laneHosts.map((host) => host.name)).toEqual([
      SYNTHESIZED_HOST_NAME,
    ]);
    // And the deprecation is still reported: the alias WAS used.
    expect(result.deprecations).toHaveLength(1);
  });

  test("a seat may name the synthesized host", () => {
    const yaml = [
      ALIAS,
      "seats:",
      "  - id: legacy",
      "    agent: lane",
      "    model: openrouter/stealth/space-bunny-alpha",
      `    host: ${SYNTHESIZED_HOST_NAME}`,
    ].join("\n");
    expect(parseConfig(yaml).problems).toEqual([]);
  });

  test("an alias that is not a string is refused at opencodeServerUrl, and synthesizes nothing", () => {
    const result = parseConfig("opencodeServerUrl: 4096\n");
    expect(result.problems.map((p) => p.at)).toEqual(["opencodeServerUrl"]);
    expect(result.config?.laneHosts).toEqual([]);
    expect(result.deprecations).toEqual([]);
  });
});

describe("A-30 §1.3: the alias is a URL, or it is refused at opencodeServerUrl", () => {
  test.each([
    ["an empty string", '""'],
    ["a host:port with no scheme", "127.0.0.1:4096"],
    ["a non-http scheme", "ftp://127.0.0.1:4096"],
  ])(
    "%s is a problem at opencodeServerUrl, and synthesizes nothing",
    (_, value) => {
      const result = parseConfig(`opencodeServerUrl: ${value}\n`);
      expect(result.problems.map((p) => p.at)).toEqual(["opencodeServerUrl"]);
      expect(result.config?.laneHosts).toEqual([]);
      expect(result.deprecations).toEqual([]);
    },
  );

  test("a trailing slash is stripped before /doc is appended", () => {
    const result = parseConfig("opencodeServerUrl: http://127.0.0.1:4096/\n");
    expect(result.problems).toEqual([]);
    expect(result.config?.laneHosts[0]?.check).toEqual([
      "curl",
      "-sf",
      "http://127.0.0.1:4096/doc",
    ]);
  });
});

/**
 * OW1's fixture overlay, which A-30 §6 migrates. It is the one overlay in this
 * repository that a real project already runs against, so it is the one that
 * proves the schema against a file nobody here wrote for the schema — including
 * the `appendOnlyPaths` that was a YAML LIST, which the parser refuses ("must be
 * a string") because the field is one regular expression.
 */
const FIXTURE = resolve(
  import.meta.dirname,
  "../../../../packages/template-engine/__tests__/fixtures/orchestration/campaign-foundry/overlay/config.yaml",
);

describe("A-30 §6: OW1's migrated fixture overlay parses with nothing to fix", () => {
  const text = readFileSync(FIXTURE, "utf8");
  const result = parseConfig(text);

  test("zero problems and zero deprecations", () => {
    expect(result.problems).toEqual([]);
    expect(result.deprecations).toEqual([]);
  });

  test("it declares exactly the local-opencode host, and no seats", () => {
    expect(result.config?.laneHosts).toEqual([
      {
        name: "local-opencode",
        dispatch: ["opencode", "run", "--attach", "http://127.0.0.1:4096"],
        check: ["curl", "-sf", "http://127.0.0.1:4096/doc"],
        gate: "full",
      },
    ]);
    // No seats, deliberately: so `doctor` has exactly one WARN to report here, and
    // OW8's seeded run has one predictable finding to assert.
    expect(result.config?.seats).toEqual([]);
  });

  test("it no longer sets the retired alias, so nothing is deprecated", () => {
    expect(text).not.toContain("opencodeServerUrl");
  });

  test("its appendOnlyPaths is ONE regex matching the same paths the list did", () => {
    const pattern = result.config!.appendOnlyPaths!;
    expect(typeof pattern).toBe("string");
    const matches = new RegExp(pattern);
    for (const path of [
      ".agents/session-log.md",
      "CHANGELOG.md",
      "packages/core/src/application/ports/out/index.ts",
      "apps/web/src/components/ui/index.ts",
      "apps/web/src/components/campaign/messages.ts",
    ]) {
      expect(matches.test(path), `matches ${path}`).toBe(true);
    }
    for (const path of [
      "src/index.ts",
      "packages/core/src/application/ports/out/types.ts",
      "apps/web/src/components/ui/button.tsx",
      "packages/core/deep/src/application/ports/out/index.ts",
      "CHANGELOG.draft.md",
    ]) {
      expect(matches.test(path), `does not match ${path}`).toBe(false);
    }
  });
});
