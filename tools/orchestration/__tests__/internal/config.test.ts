import { describe, expect, test } from "vitest";
import {
  DEFAULT_WAVE_STATUS_PORT,
  INVARIANT_NAMES,
  LOCKED_INVARIANTS,
  emptyConfig,
  loadConfig,
  matchesAppendOnly,
  parseConfig,
  readOverrides,
} from "../../src/internal/config.js";

/**
 * The overlay loader's contract (OW-D7, as amended by §12 A-15, A-20, A-21,
 * A-22 and A-30).
 *
 * Two things are being held here at once. A field that is ABSENT must take its
 * documented default, or a bin reads `undefined` and guesses. A field that is
 * PRESENT and wrong must be an error, or the gate substitutes a default for a
 * misspelled value and passes without running what was asked.
 */

const ok = (text: string) => {
  const result = parseConfig(text);
  expect(result.problems, `problems for:\n${text}`).toEqual([]);
  return result.config!;
};

describe("the schema is exactly these sixteen fields", () => {
  test("an empty file validates and yields every default", () => {
    expect(ok("{}")).toEqual(emptyConfig());
  });

  test("all sixteen field names are accepted together", () => {
    const config = ok(
      [
        "planDir: docs/planning",
        "gateSteps:",
        "  - name: build",
        "    command: yarn build",
        "requiredCheck: ^Build",
        "appendOnlyPaths: '^docs/'",
        "forbiddenPorts: [3000, 3001]",
        "operatorDataPaths: ['.env.local']",
        "laneHosts:",
        "  - name: local",
        "    dispatch: [opencode, run]",
        "    gate: full",
        "seats:",
        "  - id: space-bunny",
        "    agent: lane",
        "    model: openrouter/stealth/space-bunny-alpha",
        "    host: local",
        "waveLogDir: $HOME/.waves-hexagen",
        "coverageRequirement: 80",
        "mutate: true",
        "tokensCssPath: apps/web/src/styles/tokens.css",
        "overrides:",
        "  - invariant: eventDuty",
        "    reason: the gate emits its own events",
        "invariants:",
        "  statusSource: derived",
        "  eventDuty: false",
        "  mergeRequiresGreenGate: true",
        "  attribution: false",
        "repo: owner/name",
        "waveStatusPort: 4318",
      ].join("\n"),
    );

    expect(config.planDir).toBe("docs/planning");
    expect(config.gateSteps).toEqual([
      { name: "build", command: "yarn build" },
    ]);
    expect(config.requiredCheck).toBe("^Build");
    expect(config.appendOnlyPaths).toBe("^docs/");
    expect(config.forbiddenPorts).toEqual([3000, 3001]);
    expect(config.operatorDataPaths).toEqual([".env.local"]);
    expect(config.laneHosts).toEqual([
      { name: "local", dispatch: ["opencode", "run"], gate: "full" },
    ]);
    expect(config.seats).toEqual([
      {
        id: "space-bunny",
        agent: "lane",
        model: "openrouter/stealth/space-bunny-alpha",
        host: "local",
      },
    ]);
    expect(config.waveLogDir).toBe("$HOME/.waves-hexagen");
    expect(config.coverageRequirement).toBe(80);
    expect(config.mutate).toBe(true);
    expect(config.tokensCssPath).toBe("apps/web/src/styles/tokens.css");
    expect(config.overrides).toEqual([
      { invariant: "eventDuty", reason: "the gate emits its own events" },
    ]);
    expect(config.repo).toBe("owner/name");
    expect(config.waveStatusPort).toBe(4318);
    // The override above is what makes eventDuty: false legal.
    expect(config.invariants.eventDuty).toBe(false);
  });
});

describe("a field that is absent takes its documented default", () => {
  const absent = <K extends keyof ReturnType<typeof emptyConfig>>(field: K) => {
    const config = ok("{}");
    expect(
      Object.prototype.hasOwnProperty.call(config, field),
      `${field} must be absent`,
    ).toBe(
      field === "waveLogDir" ||
        field === "appendOnlyPaths" ||
        field === "coverageRequirement" ||
        field === "tokensCssPath" ||
        field === "repo"
        ? false
        : true,
    );
  };

  test("planDir defaults to docs/planning", () => {
    expect(ok("{}").planDir).toBe("docs/planning");
  });

  test("gateSteps defaults to an empty list — the gate bin requires its own", () => {
    expect(ok("{}").gateSteps).toEqual([]);
  });

  test("requiredCheck defaults to ^Build", () => {
    expect(ok("{}").requiredCheck).toBe("^Build");
  });

  test("forbiddenPorts defaults to [] — refused ports come only from the file (A-20)", () => {
    // Not [3000, 3001]: `init` writes those into the file it scaffolds, but a
    // loader default of them would refuse campaign-foundry's own 4317 project
    // without its overlay saying so.
    expect(ok("{}").forbiddenPorts).toEqual([]);
    expect(DEFAULT_WAVE_STATUS_PORT).toBe(4318);
    expect(ok("{}").forbiddenPorts).not.toContain(4318);
  });

  test("operatorDataPaths defaults to []", () => {
    expect(ok("{}").operatorDataPaths).toEqual([]);
  });

  test("A30: laneHosts defaults to [] — a project may declare no lane host", () => {
    expect(ok("{}").laneHosts).toEqual([]);
  });

  test("A30: seats defaults to []", () => {
    expect(ok("{}").seats).toEqual([]);
  });

  test("waveLogDir is absent, so logdir.ts derives $HOME/.waves-<name>", () => {
    expect(ok("{}").waveLogDir).toBeUndefined();
  });

  test("coverageRequirement is absent", () => {
    expect(ok("{}").coverageRequirement).toBeUndefined();
  });

  test("mutate defaults to false", () => {
    expect(ok("{}").mutate).toBe(false);
  });

  test("tokensCssPath is absent, so wave-status serves its neutral token set", () => {
    expect(ok("{}").tokensCssPath).toBeUndefined();
  });

  test("overrides defaults to []", () => {
    expect(ok("{}").overrides).toEqual([]);
  });

  test("invariants defaults to the locked set", () => {
    expect(ok("{}").invariants).toEqual(LOCKED_INVARIANTS);
    for (const name of INVARIANT_NAMES) {
      expect(ok("{}").invariants[name], name).toBe(LOCKED_INVARIANTS[name]);
    }
  });

  test("repo is absent — it needs gh", () => {
    expect(ok("{}").repo).toBeUndefined();
    absent("repo");
  });

  test("F3: appendOnlyPaths is absent, and the default matches nothing", () => {
    expect(ok("{}").appendOnlyPaths).toBeUndefined();
    absent("appendOnlyPaths");
    // `new RegExp("")` matches every path; the absent default must not.
    for (const path of ["packages/sync/src/index.ts", "", "docs/x.md"]) {
      expect(matchesAppendOnly(ok("{}"), path), path).toBe(false);
    }
  });

  test("F3: a set appendOnlyPaths matches as a regex, and an empty one still matches nothing", () => {
    const config = ok("appendOnlyPaths: '^docs/'");
    expect(matchesAppendOnly(config, "docs/x.md")).toBe(true);
    expect(matchesAppendOnly(config, "src/x.ts")).toBe(false);
    expect(matchesAppendOnly(ok("appendOnlyPaths: ''"), "src/x.ts")).toBe(
      false,
    );
  });

  test("F15: an invalid appendOnlyPaths regex is a problem, and the field is left off", () => {
    const result = parseConfig('appendOnlyPaths: "("');
    expect(result.problems.map((p) => p.at)).toEqual(["appendOnlyPaths"]);
    expect(result.config).not.toHaveProperty("appendOnlyPaths");
    expect(() =>
      matchesAppendOnly(result.config!, "packages/sync/src/index.ts"),
    ).not.toThrow();
    expect(
      matchesAppendOnly(result.config!, "packages/sync/src/index.ts"),
    ).toBe(false);
  });

  test("waveStatusPort defaults to 4318", () => {
    expect(ok("{}").waveStatusPort).toBe(4318);
  });
});

describe("an unknown key is refused", () => {
  test("an unknown key is a problem naming the key and the known set", () => {
    const result = parseConfig("planDir: docs/planning\nnope: 1\n");
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].at).toBe("nope");
    expect(result.problems[0].message).toContain("not a known setting");
    expect(result.problems[0].message).toContain("planDir");
  });

  test("cast is refused, and named as the cast file it seems to want", () => {
    // OW-D7: `cast` is an ILLEGAL key.
    const result = parseConfig("cast:\n  - name: Ada\n");
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].at).toBe("cast");
    expect(result.problems[0].message).toContain("cast.md");
  });

  test("a field of the wrong type is refused", () => {
    for (const [yaml, at] of [
      ["planDir: [a, b]", "planDir"],
      ["mutate: 'yes'", "mutate"],
      ["forbiddenPorts: ['3000']", "forbiddenPorts"],
      ["operatorDataPaths: 'one'", "operatorDataPaths"],
      ["waveStatusPort: '4318'", "waveStatusPort"],
      ["coverageRequirement: 'eighty'", "coverageRequirement"],
      ["gateSteps: 'build'", "gateSteps"],
      ["repo: 42", "repo"],
    ] as const) {
      const result = parseConfig(yaml);
      expect(
        result.problems.map((p) => p.at),
        yaml,
      ).toContain(at);
    }
  });

  test("a repo that is not owner/name is refused rather than resolved from the typo", () => {
    for (const repo of ["no-slash", "owner/", "/name", "a b/c"]) {
      const result = parseConfig(`repo: ${JSON.stringify(repo)}`);
      expect(
        result.problems.map((p) => p.at),
        repo,
      ).toContain("repo");
    }
  });

  test("invalid YAML is a whole-file problem, not a crash", () => {
    const result = parseConfig("planDir: [unclosed\n");
    expect(result.config).toBeUndefined();
    expect(result.problems[0].at).toBe("<file>");
    expect(result.problems[0].message).toContain("not valid YAML");
    expect(result.deprecations).toEqual([]);
  });

  test("a document that is not a mapping is refused", () => {
    const result = parseConfig("- one\n- two\n");
    expect(result.problems[0].at).toBe("<file>");
  });

  test("an empty file is the empty config, not an error", () => {
    const result = parseConfig("");
    expect(result.problems).toEqual([]);
    expect(result.config).toEqual(emptyConfig());
  });
});

describe("overrides[] is the only way to move a locked invariant", () => {
  test("an entry with no reason is refused", () => {
    const result = parseConfig("overrides:\n  - invariant: eventDuty\n");
    expect(result.problems.map((p) => p.at)).toContain("overrides[0].reason");
  });

  test("an entry with an empty or non-string reason is refused", () => {
    for (const reason of ["''", "42"]) {
      const result = parseConfig(
        `overrides:\n  - invariant: eventDuty\n    reason: ${reason}\n`,
      );
      expect(
        result.problems.map((p) => p.at),
        reason,
      ).toContain("overrides[0].reason");
    }
  });

  test("an entry that is not a mapping is refused", () => {
    const result = parseConfig("overrides:\n  - eventDuty\n");
    expect(result.problems.map((p) => p.at)).toContain("overrides[0]");
  });

  test("an invariant outside the locked set is refused", () => {
    const result = parseConfig(
      "overrides:\n  - invariant: notAnInvariant\n    reason: because\n",
    );
    expect(result.problems.map((p) => p.at)).toContain(
      "overrides[0].invariant",
    );
  });

  test("an invariant that differs from its default with no override is refused", () => {
    const result = parseConfig("invariants:\n  eventDuty: false\n");
    expect(result.problems.map((p) => p.at)).toContain("invariants.eventDuty");
    expect(result.problems[0].message).toContain("no overrides[] entry");
  });

  test("the same difference WITH a matching override is accepted", () => {
    const config = ok(
      [
        "invariants:",
        "  eventDuty: false",
        "overrides:",
        "  - invariant: eventDuty",
        "    reason: the gate emits its own events",
      ].join("\n"),
    );
    expect(config.invariants.eventDuty).toBe(false);
  });

  test("an override naming a DIFFERENT invariant does not cover this one", () => {
    const result = parseConfig(
      [
        "invariants:",
        "  eventDuty: false",
        "overrides:",
        "  - invariant: attribution",
        "    reason: we do want attribution",
      ].join("\n"),
    );
    expect(result.problems.map((p) => p.at)).toContain("invariants.eventDuty");
  });

  test("an unknown key inside invariants is refused", () => {
    const result = parseConfig("invariants:\n  somethingElse: 1\n");
    expect(result.problems[0].at).toBe("invariants.somethingElse");
    expect(result.problems[0].message).toContain("statusSource");
  });

  test("an invariants value that is not a mapping is refused", () => {
    const result = parseConfig("invariants: true\n");
    expect(result.problems.map((p) => p.at)).toContain("invariants");
  });

  test("readOverrides returns [] for absent, and the raw entries otherwise", () => {
    // Kept raw on purpose: `doctor` has to report a malformed entry, so it
    // needs the entry as written rather than a filtered list.
    expect(readOverrides(undefined)).toEqual([]);
    expect(readOverrides([{ invariant: "eventDuty" }])).toEqual([
      { invariant: "eventDuty" },
    ]);
  });
});

describe("gateSteps", () => {
  test("an optional step is kept, so the gate can report SKIPPED rather than passed", () => {
    const config = ok(
      "gateSteps:\n  - name: coverage\n    command: yarn cov\n    optional: true\n",
    );
    expect(config.gateSteps[0]).toEqual({
      name: "coverage",
      command: "yarn cov",
      optional: true,
    });
  });

  describe("F2: only a literal true marks a step optional", () => {
    const step = (optional: string) =>
      `gateSteps:\n  - name: coverage\n    command: yarn coverage\n${optional}`;

    test.each([
      [
        "optional: no",
        "a YAML 1.1 boolean word that YAML 1.2 reads as a string",
      ],
      ["optional:", "null"],
      ['optional: "false"', "a quoted string"],
      ["optional: 0", "a number"],
    ])("%s is a problem at gateSteps[0].optional (%s)", (line) => {
      const result = parseConfig(step(`    ${line}\n`));
      expect(result.problems.map((p) => p.at)).toEqual([
        "gateSteps[0].optional",
      ]);
    });

    test("a bad value never yields an optional step", () => {
      const result = parseConfig(step("    optional: no\n"));
      expect(result.config?.gateSteps).toHaveLength(1);
      expect(result.config?.gateSteps[0]?.optional).not.toBe(true);
    });

    test("optional: true is optional", () => {
      const config = ok(step("    optional: true\n"));
      expect(config.gateSteps[0]?.optional).toBe(true);
    });

    test("optional: false and an absent key are both required", () => {
      expect(ok(step("    optional: false\n")).gateSteps[0]?.optional).not.toBe(
        true,
      );
      expect(ok(step("")).gateSteps[0]?.optional).not.toBe(true);
    });
  });

  describe("F22: only a literal true marks a step locked", () => {
    const step = (locked: string) =>
      `gateSteps:\n  - name: test\n    command: yarn test\n${locked}`;

    test.each([
      ["locked: no", "a YAML 1.1 boolean word"],
      ["locked:", "null"],
      ['locked: "false"', "a quoted string"],
      ["locked: 0", "a number"],
    ])("%s is a problem at gateSteps[0].locked (%s)", (line) => {
      const result = parseConfig(step(`    ${line}\n`));
      expect(result.problems.map((p) => p.at)).toEqual(["gateSteps[0].locked"]);
      expect(result.config?.gateSteps[0]?.locked).not.toBe(true);
    });

    test("locked: true is locked", () => {
      expect(ok(step("    locked: true\n")).gateSteps[0]?.locked).toBe(true);
    });

    test("locked: false and an absent key are both not locked", () => {
      expect(ok(step("    locked: false\n")).gateSteps[0]?.locked).not.toBe(
        true,
      );
      expect(ok(step("")).gateSteps[0]?.locked).not.toBe(true);
    });

    test("locked and optional are independent", () => {
      const s = ok(step("    locked: true\n    optional: true\n")).gateSteps[0];
      expect(s).toEqual({
        name: "test",
        command: "yarn test",
        optional: true,
        locked: true,
      });
    });
  });

  test("a step with no name or no command is refused, naming the index", () => {
    expect(
      parseConfig("gateSteps:\n  - command: yarn build\n").problems[0].at,
    ).toBe("gateSteps[0].name");
    expect(parseConfig("gateSteps:\n  - name: build\n").problems[0].at).toBe(
      "gateSteps[0].command",
    );
  });

  test("a step that is not a mapping is refused", () => {
    expect(parseConfig("gateSteps:\n  - build\n").problems[0].at).toBe(
      "gateSteps[0]",
    );
  });
});

describe("loadConfig", () => {
  const io = (config: string | undefined, repo: string | undefined) => ({
    readConfig: async () => config,
    repo: async () => repo,
  });

  test("A30: a deprecation survives every path loadConfig rebuilds", async () => {
    const alias = "opencodeServerUrl: http://127.0.0.1:4096\n";
    // The file's own repo: returned whole.
    expect(
      (await loadConfig(io(alias + "repo: owner/one\n", "octocat/two")))
        .deprecations,
    ).toHaveLength(1);
    // gh supplies repo: rebuilt config, carried deprecations.
    expect(
      (await loadConfig(io(alias, "octocat/two"))).deprecations,
    ).toHaveLength(1);
    // gh cannot supply repo: returned untouched, carried them anyway.
    expect((await loadConfig(io(alias, undefined))).deprecations).toHaveLength(
      1,
    );
    // gh answers with rubbish: problems are appended, deprecations carried.
    const bad = await loadConfig(io(alias, "garbage"));
    expect(bad.problems.map((p) => p.at)).toContain("repo");
    expect(bad.deprecations).toHaveLength(1);
    // An absent file has nothing to deprecate.
    expect(
      (await loadConfig(io(undefined, "octocat/two"))).deprecations,
    ).toEqual([]);
  });

  test("derives repo from gh when the file omits it", async () => {
    const result = await loadConfig(
      io("planDir: docs/planning\n", "octocat/Hello-World"),
    );
    expect(result.config?.repo).toBe("octocat/Hello-World");
    expect(result.problems).toEqual([]);
  });

  test("an absent file is not an error — every default, and repo from gh", async () => {
    const result = await loadConfig(io(undefined, "octocat/Hello-World"));
    expect(result.problems).toEqual([]);
    expect(result.config).toEqual({
      ...emptyConfig(),
      repo: "octocat/Hello-World",
    });
  });

  test("a file's own repo wins over gh's", async () => {
    const result = await loadConfig(io("repo: owner/one\n", "octocat/two"));
    expect(result.config?.repo).toBe("owner/one");
  });

  test("repo stays absent when neither the file nor gh can supply it", async () => {
    const result = await loadConfig(io("planDir: docs/planning\n", undefined));
    expect(result.config?.repo).toBeUndefined();
    expect(result.problems).toEqual([]);
  });

  test("a gh answer that is not owner/name is reported, not accepted", async () => {
    const result = await loadConfig(io("planDir: docs/planning\n", "garbage"));
    expect(result.problems.map((p) => p.at)).toContain("repo");
    expect(result.config?.repo).toBeUndefined();
  });

  test("a file with a schema problem still gets its repo from gh, and keeps its problems", async () => {
    const result = await loadConfig(io("nope: 1\n", "octocat/Hello-World"));
    expect(result.problems.map((p) => p.at)).toEqual(["nope"]);
    expect(result.config?.repo).toBe("octocat/Hello-World");
  });

  test("a repo the file got wrong is not papered over with gh's answer", async () => {
    const result = await loadConfig(
      io("repo: no-slash\n", "octocat/Hello-World"),
    );
    expect(result.problems.map((p) => p.at)).toEqual(["repo"]);
    expect(result.config?.repo).toBeUndefined();
  });

  test("a file that is not YAML has no config at all, and gh is not asked", async () => {
    let asked = false;
    const result = await loadConfig({
      readConfig: async () => "planDir: [unclosed\n",
      repo: async () => {
        asked = true;
        return "octocat/Hello-World";
      },
    });
    expect(result.config).toBeUndefined();
    expect(result.problems[0]?.at).toBe("<file>");
    expect(asked).toBe(false);
  });
});

describe("F9: parseConfig returns the parsed config alongside its problems", () => {
  test("the fields that were fine hold what the file said; the bad one is at its default", () => {
    const result = parseConfig(
      "forbiddenPorts: [4318]\nlaneHosts:\n  - name: local\n    dispatch: [opencode]\n    gate: full\nmutate: 'yes'\nnope: 1\n",
    );
    expect(result.problems.map((p) => p.at).sort()).toEqual(["mutate", "nope"]);
    expect(result.config?.forbiddenPorts).toEqual([4318]);
    // A-30: a deprecated alias never becomes a config field, but the host it is
    // synthesized into is a first-class one.
    expect(result.config).not.toHaveProperty("opencodeServerUrl");
    // Nothing deprecated is written here, so there is nothing to deprecate.
    expect(result.deprecations).toEqual([]);
    expect(result.config?.laneHosts).toHaveLength(1);
    expect(result.config?.mutate).toBe(false);
  });
});
