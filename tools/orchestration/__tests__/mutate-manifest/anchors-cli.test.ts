import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_MANIFEST_DIR,
  EXIT_UNUSABLE,
  runAnchorCli,
  type AnchorCliIo,
} from "../../src/mutate-manifest/anchors-cli.js";

const manifestText = JSON.stringify({
  version: 1,
  lane: "W4",
  mutations: [
    {
      file: "src/target.ts",
      before: "const gate = true;",
      after: "const gate = false;",
      because: "the guard must red",
      command: ["yarn", "t"],
      verdict: "caught",
    },
  ],
});

const io = (
  over: Partial<AnchorCliIo> = {},
): AnchorCliIo & { logs: string[] } => {
  const logs: string[] = [];
  return {
    logs,
    argv: [],
    log: (text) => logs.push(text),
    logError: (text) => logs.push(text),
    listManifests: async () => ["d/m.json"],
    deps: {
      readText: async (path) =>
        path.endsWith(".json") ? manifestText : "const gate = true;\n",
      listTests: async () => {
        throw new Error("no listing was expected");
      },
      now: () => 0,
    },
    ...over,
  };
};

describe("runAnchorCli", () => {
  test("passes a tree whose anchors all resolve", async () => {
    const cli = io();
    expect(await runAnchorCli(cli)).toBe(0);
    expect(cli.logs.join("\n")).toContain(
      "Every live anchor resolves exactly once",
    );
  });

  test("fails, non-zero, on a dead anchor", async () => {
    const cli = io({
      deps: {
        readText: async (p) => (p.endsWith(".json") ? manifestText : ""),
        listTests: async () => [],
        now: () => 0,
      },
    });
    expect(await runAnchorCli(cli)).toBe(1);
    expect(cli.logs.join("\n")).toContain("DEAD ANCHOR  d/m.json#0");
  });

  /** A manifest whose `-t` cannot be proved by syntax, so vitest is asked. */
  const dead = JSON.stringify({
    version: 1,
    lane: "W4",
    mutations: [
      {
        file: "src/target.ts",
        before: "const gate = true;",
        after: "const gate = false;",
        because: "the guard must red",
        command: [
          "yarn",
          "vitest",
          "run",
          "src/__tests__/t.test.ts",
          "-t",
          "renamed away",
        ],
        verdict: "caught",
      },
    ],
  });

  /**
   * Both listings, told apart by whether `-t` survived the rewrite: the
   * selecting one is what the replay runs, the bare one is what the file
   * registers. `selected` and `registered` are what each answers.
   */
  const listings = (
    selected: readonly string[],
    registered: readonly string[],
  ) => {
    const seen: string[][] = [];
    return {
      seen,
      listTests: async (command: readonly string[]) => {
        seen.push([...command]);
        return command.includes("-t") ? selected : registered;
      },
    };
  };

  test("fails, non-zero, on a -t pattern that selects nothing — both checks are one gate", async () => {
    // The file registers a test; the pattern simply does not pick it. A finding:
    // a replay here reports "survived" without having run anything.
    const { listTests, seen } = listings([], ["the test under its new name"]);
    const cli = io({
      deps: {
        readText: async (p) =>
          p.endsWith(".json") ? dead : "const gate = true;\n",
        listTests,
        now: () => 0,
      },
    });
    expect(await runAnchorCli(cli)).toBe(1);
    expect(cli.logs.join("\n")).toContain("DEAD -t PATTERN  d/m.json#0");
    // It asked twice, and the second time without the selector.
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toContain("-t");
    expect(seen[1]).not.toContain("renamed away");
  });

  test("a file that registers nothing HERE is unlistable, not a dead pattern", async () => {
    // Same empty selection, different cause: the environment cannot run the
    // file at all. Reporting this as a dead pattern sends a lane hunting for a
    // manifest defect that is not there — measured against one manifest entry
    // in a worktree whose install had skipped its postinstall step, and whose
    // pattern was fine.
    const { listTests } = listings([], []);
    const cli = io({
      deps: {
        readText: async (p) =>
          p.endsWith(".json") ? dead : "const gate = true;\n",
        listTests,
        now: () => 0,
      },
    });
    expect(await runAnchorCli(cli)).toBe(1);
    const logs = cli.logs.join("\n");
    expect(logs).toContain("registers no tests in this environment");
    expect(logs).not.toContain("DEAD -t PATTERN");
  });

  test("a bare listing that throws is unlistable too, never a silent pass", async () => {
    const cli = io({
      deps: {
        readText: async (p) =>
          p.endsWith(".json") ? dead : "const gate = true;\n",
        listTests: async (command) => {
          if (!command.includes("-t")) throw new Error("vitest exploded");
          return [];
        },
        now: () => 0,
      },
    });
    expect(await runAnchorCli(cli)).toBe(1);
    expect(cli.logs.join("\n")).toContain("vitest exploded");
  });

  test("walks the whole directory, never a diff — that is the hole it exists to close", async () => {
    const listManifests = vi.fn(async () => ["d/m.json"]);
    await runAnchorCli(io({ listManifests }));
    expect(listManifests).toHaveBeenCalledWith(DEFAULT_MANIFEST_DIR);
  });

  test("checks the directory it is given when one is named", async () => {
    const listManifests = vi.fn(async () => ["d/m.json"]);
    await runAnchorCli(io({ argv: ["elsewhere/manifests"], listManifests }));
    expect(listManifests).toHaveBeenCalledWith("elsewhere/manifests");
  });

  test("refuses to call a directory it cannot list 'nothing to check'", async () => {
    const cli = io({
      listManifests: async () => {
        throw new Error("EACCES");
      },
    });
    expect(await runAnchorCli(cli)).toBe(EXIT_UNUSABLE);
    expect(cli.logs.join("\n")).toContain(
      "refusing to report that as nothing to check",
    );
  });

  test("names a non-Error listing failure rather than printing [object Object]", async () => {
    const cli = io({
      listManifests: async () => {
        throw "EPERM";
      },
    });
    expect(await runAnchorCli(cli)).toBe(EXIT_UNUSABLE);
    expect(cli.logs.join("\n")).toContain("EPERM");
  });

  test("says so, out loud, when the directory holds no manifests at all", async () => {
    const cli = io({ listManifests: async () => [] });
    expect(await runAnchorCli(cli)).toBe(0);
    expect(cli.logs.join("\n")).toContain(
      "no manifests in .agents/manifests; nothing to check",
    );
  });
});
