import { describe, expect, test } from "vitest";
import { readFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import {
  LANE_DIR,
  OVERLAY_DIR,
  SCAFFOLD_FILES,
  TEMPLATE_CONFIG_PATH,
  formatReport,
  readAgentsMdAnswer,
  runInit,
} from "../../src/init/init.js";
import {
  emptyConfig,
  matchesAppendOnly,
  parseConfig,
  type Config,
} from "../../src/internal/config.js";

/**
 * `hexagen-orchestration-init` (OW-D7; F-14).
 *
 * The property that matters is **running it twice changes nothing**. Not "the
 * files happen to come out the same" — nothing at all: no write, no truncation,
 * no rewrite of a file a human has since edited. A naive scaffold passes the
 * first run and silently reverts every edit on the second, which is why the
 * red case here is a real second run against real files on disk, byte-compared.
 */

const dirs: string[] = [];
const project = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "orchestration-init-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

/** Run `init` against a real directory, as the bin does. */
async function init(root: string, config: Config = emptyConfig()) {
  const at = (path: string): string => join(root, path);
  return runInit(config, {
    exists: async (path) => {
      try {
        await readFile(at(path), "utf8");
        return true;
      } catch {
        return false;
      }
    },
    write: async (path, contents) => {
      const full = at(path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, contents, "utf8");
    },
    readTemplateConfig: async () => {
      try {
        return await readFile(at(TEMPLATE_CONFIG_PATH), "utf8");
      } catch {
        return undefined;
      }
    },
  });
}

/** Every scaffolded file's bytes, keyed by its root-relative path. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of SCAFFOLD_FILES) {
    out[file.path] = await readFile(join(root, file.path), "utf8");
  }
  return out;
}

/** A real git repository, because `git check-ignore` is the claim under test. */
function gitRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "orchestration-init-git-"));
  dirs.push(root);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  return root;
}

describe("§7 init: run twice, everything is byte-identical (F-14)", () => {
  test("the second run writes nothing and leaves every file identical", async () => {
    const root = project();

    const first = await init(root);
    expect(first.outcomes.every((o) => o.action === "created")).toBe(true);
    const afterFirst = await snapshot(root);

    const second = await init(root);
    expect(second.outcomes.every((o) => o.action === "skipped")).toBe(true);
    const afterSecond = await snapshot(root);

    expect(afterSecond).toEqual(afterFirst);
  });

  test("a file a human has since edited is not reverted by a later run", async () => {
    // The red for a naive scaffold: the second run rewrites this and the
    // operator's edit is gone, with nothing said about it.
    const root = project();
    await init(root);

    const edited = join(root, OVERLAY_DIR, "lessons.md");
    const mine = "# Lessons\n\nDo not lose this.\n";
    await writeFile(edited, mine, "utf8");

    const again = await init(root);

    expect(again.outcomes.find((o) => o.file === "lessons.md")?.action).toBe(
      "skipped",
    );
    expect(await readFile(edited, "utf8")).toBe(mine);
  });

  test("a partially scaffolded overlay is completed, not restarted", async () => {
    const root = project();
    await mkdir(join(root, OVERLAY_DIR), { recursive: true });
    const mine = "# House rules\n\nMine.\n";
    await writeFile(join(root, OVERLAY_DIR, "house-rules.md"), mine, "utf8");

    const result = await init(root);

    expect(
      result.outcomes.find((o) => o.file === "house-rules.md")?.action,
    ).toBe("skipped");
    expect(result.outcomes.filter((o) => o.action === "created")).toHaveLength(
      4,
    );
    expect(
      await readFile(join(root, OVERLAY_DIR, "house-rules.md"), "utf8"),
    ).toBe(mine);
  });

  test("it scaffolds four files under .agents/orchestration/ and one under .lane/", async () => {
    const root = project();
    await init(root);
    expect((await readdir(join(root, OVERLAY_DIR))).sort()).toEqual([
      "cast.md",
      "config.yaml",
      "house-rules.md",
      "lessons.md",
    ]);
    expect((await readdir(join(root, LANE_DIR))).sort()).toEqual([
      ".gitignore",
    ]);
    expect(SCAFFOLD_FILES.map((f) => f.path)).toEqual([
      OVERLAY_DIR + "/config.yaml",
      OVERLAY_DIR + "/house-rules.md",
      OVERLAY_DIR + "/cast.md",
      OVERLAY_DIR + "/lessons.md",
      LANE_DIR + "/.gitignore",
    ]);
  });

  test("the report says what it left alone, so silence never reads as 'nothing to do'", async () => {
    const root = project();
    await init(root);
    const second = await init(root);
    const text = formatReport(second.outcomes);
    expect(text).toContain("kept");
    expect(text).toContain("left 5 untouched");
    expect(text).toContain("never overwritten");
    // Both directories are named, because the scaffold no longer writes only one.
    const fresh = await init(project());
    expect(formatReport(fresh.outcomes)).toContain(
      "into .agents/orchestration/ and .lane/.",
    );
  });
});

describe("the scaffolded config.yaml (A-18, A-20)", () => {
  test("it writes waveLogDir explicitly, never leaving the shared root implied", async () => {
    const root = project();
    await init(root, { ...emptyConfig(), repo: "acme/demo" });
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    expect(text).toContain("waveLogDir:");
    // And the value it writes parses as this package's own schema.
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
  });

  test("F1: for repo acme/demo the value is exactly $HOME/.waves-demo, and no file carries a placeholder", async () => {
    const root = project();
    await init(root, { ...emptyConfig(), repo: "acme/demo" });
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.config?.waveLogDir).toBe("$HOME/.waves-demo");
    for (const name of await readdir(join(root, OVERLAY_DIR))) {
      const body = await readFile(join(root, OVERLAY_DIR, name), "utf8");
      expect(body, name).not.toContain("<repo name>");
    }
    const rules = await readFile(
      join(root, OVERLAY_DIR, "house-rules.md"),
      "utf8",
    );
    expect(rules).toContain("$HOME/.waves-demo");
  });

  test("F1: with no resolvable repo the key is omitted, and no file carries a placeholder", async () => {
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    expect(text).not.toMatch(/^waveLogDir:/m);
    expect(parseConfig(text).config?.waveLogDir).toBeUndefined();
    for (const name of await readdir(join(root, OVERLAY_DIR))) {
      const body = await readFile(join(root, OVERLAY_DIR, name), "utf8");
      expect(body, name).not.toContain("<repo name>");
    }
  });

  test("F3: it scaffolds no appendOnlyPaths line, so nothing is append-only by accident", async () => {
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    expect(text).not.toContain("appendOnlyPaths");
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.config?.appendOnlyPaths).toBeUndefined();
    expect(
      matchesAppendOnly(parsed.config!, "packages/sync/src/index.ts"),
    ).toBe(false);
  });

  test("a planDir holding YAML syntax round-trips through init then parseConfig unchanged", async () => {
    const root = project();
    const planDir = "docs/a: b #c";
    await init(root, { ...emptyConfig(), planDir });
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.config?.planDir).toBe(planDir);
  });

  test("it writes forbiddenPorts as [3000, 3001] (A-20)", async () => {
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.config?.forbiddenPorts).toEqual([3000, 3001]);
  });

  test("the scaffolded config does not put its own status port in forbiddenPorts", async () => {
    // Otherwise the scaffolded project could never start its own server.
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    const parsed = parseConfig(text);
    expect(parsed.config!.forbiddenPorts).not.toContain(
      parsed.config!.waveStatusPort,
    );
  });

  test("the scaffolded config validates against the loader's schema", async () => {
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    // The invariant block is written at its locked defaults, so a project that
    // runs doctor immediately after init is not asked for an override it did
    // not make.
    expect(parseConfig(text).problems).toEqual([]);
  });
});

describe("the Wave Observability section follows the recorded agents_md answer", () => {
  const withRecord = (answers: unknown): string =>
    JSON.stringify({
      schemaVersion: "1",
      templates: {
        orchestration: {
          installedAt: "2026-09-29T00:00:00.000Z",
          version: "0.1.0",
          answers,
          generatedFiles: [],
        },
      },
    });

  const initWith = async (record: string | undefined) => {
    const root = project();
    const at = (path: string): string => join(root, path);
    const result = await runInit(emptyConfig(), {
      exists: async (path) => {
        try {
          await readFile(at(path), "utf8");
          return true;
        } catch {
          return false;
        }
      },
      write: async (path, contents) => {
        const full = at(path);
        await mkdir(join(full, ".."), { recursive: true });
        await writeFile(full, contents, "utf8");
      },
      readTemplateConfig: async () => record,
    });
    return {
      root,
      text: await readFile(join(root, OVERLAY_DIR, "house-rules.md"), "utf8"),
      result,
    };
  };

  test("with agents_md: false, the section AND the paste line are absent", async () => {
    const { text } = await initWith(withRecord({ agents_md: false }));
    expect(text).not.toContain("Wave Observability");
    expect(text).not.toContain("paste the section above into `AGENTS.md`");
    expect(text).not.toContain("hexagen-orchestration-wave-status");
  });

  test("with agents_md: true, both are present", async () => {
    const { text } = await initWith(withRecord({ agents_md: true }));
    expect(text).toContain("Wave Observability");
    expect(text).toContain("paste the section above into `AGENTS.md`");
  });

  test("with the record absent entirely, both are present", async () => {
    const { text } = await initWith(undefined);
    expect(text).toContain("Wave Observability");
    expect(text).toContain("paste the section above into `AGENTS.md`");
  });

  test("the section names the status bin, forbiddenPorts and waveLogDir (OW-D11)", async () => {
    const { text } = await initWith(withRecord({ agents_md: true }));
    expect(text).toContain("hexagen-orchestration-wave-status");
    expect(text).toContain("forbiddenPorts");
    expect(text).toContain("waveLogDir");
    expect(text).toContain("~/.waves");
  });

  test("readAgentsMdAnswer reads only an explicit false as a refusal", () => {
    expect(readAgentsMdAnswer(undefined)).toBe(true);
    expect(readAgentsMdAnswer(withRecord({ agents_md: true }))).toBe(true);
    expect(readAgentsMdAnswer(withRecord({ agents_md: false }))).toBe(false);
    expect(readAgentsMdAnswer(withRecord({}))).toBe(true);
    expect(readAgentsMdAnswer(withRecord({ agents_md: "false" }))).toBe(true);
    // Other templates' records, and an unreadable one, carry no opinion.
    expect(
      readAgentsMdAnswer(
        JSON.stringify({
          templates: { other: { answers: { agents_md: false } } },
        }),
      ),
    ).toBe(true);
    expect(readAgentsMdAnswer("{not json")).toBe(true);
    expect(readAgentsMdAnswer("[]")).toBe(true);
  });
});

/**
 * A-30 §4: a lane's brief lives at `<worktree>/.lane/brief.md`, and the
 * orchestrator verifies it with `git check-ignore` BEFORE dispatching. A brief
 * that is not ignored is a brief a lane can stage, and a lane that stages broadly
 * commits its own instructions into the repository.
 *
 * These run `init` against a REAL git repository and then ask git itself, because
 * the whole claim is a claim about git's resolution order, and a hand-rolled
 * model of it proves nothing.
 */
describe("A-30 §4: .lane/.gitignore is a nested ignore file, not a root edit", () => {
  const LANE_IGNORE_PATH = LANE_DIR + "/.gitignore";

  test("it holds exactly '*' and '!.gitignore', so the file is itself tracked", async () => {
    const root = project();
    await init(root);
    expect(await readFile(join(root, LANE_IGNORE_PATH), "utf8")).toBe(
      "*\n!.gitignore\n",
    );
  });

  test("git check-ignore says a brief is ignored, with NO root .gitignore edit", async () => {
    const root = gitRepository();
    await init(root);

    // Nothing at the root was touched. The file that ignores the brief lives
    // inside .lane/, and the engine cannot append to a root .gitignore (B-2).
    const rootIgnore = await readFile(join(root, ".gitignore"), "utf8").catch(
      () => "",
    );
    expect(rootIgnore, "init must not create a root .gitignore").toBe("");

    await writeFile(join(root, LANE_DIR, "brief.md"), "# brief\n", "utf8");
    const check = spawnSync("git", ["check-ignore", ".lane/brief.md"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain(".lane/brief.md");

    // And the ignore file itself is trackable, which is the whole reason for the
    // `!.gitignore` line: a file nothing can see is a file nobody commits, and a
    // lane worktree without it stops ignoring briefs.
    expect(
      spawnSync("git", ["check-ignore", ".lane/.gitignore"], { cwd: root })
        .status,
      ".lane/.gitignore must NOT be ignored, or it is untrackable",
    ).not.toBe(0);
  });

  test("a second run is byte-identical, .lane/.gitignore included", async () => {
    const root = project();
    const first = await init(root);
    const afterFirst = await snapshot(root);
    const second = await init(root);
    expect(first.outcomes).toHaveLength(5);
    expect(second.outcomes.every((o) => o.action === "skipped")).toBe(true);
    expect(
      second.outcomes.find((o) => o.path === LANE_IGNORE_PATH)?.action,
    ).toBe("skipped");
    expect(await snapshot(root)).toEqual(afterFirst);
  });

  test("an existing .lane/.gitignore is left untouched, edits and all", async () => {
    const root = project();
    await mkdir(join(root, LANE_DIR), { recursive: true });
    const mine = "*\n!.gitignore\n!keep-me/\n";
    await writeFile(join(root, LANE_IGNORE_PATH), mine, "utf8");

    await init(root);

    expect(await readFile(join(root, LANE_IGNORE_PATH), "utf8")).toBe(mine);
  });

  test("the scaffolded config.yaml documents both new fields and scaffolds neither", async () => {
    const root = project();
    await init(root);
    const text = await readFile(join(root, OVERLAY_DIR, "config.yaml"), "utf8");
    expect(text).toContain("laneHosts");
    expect(text).toContain("seats");
    // Documented, not declared: an entry here would be a lane host nobody chose.
    expect(text).toMatch(/^# laneHosts: \[\]/m);
    expect(text).toMatch(/^# seats: \[\]/m);
    // And it still parses against the schema the comment describes.
    const parsed = parseConfig(text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.deprecations).toEqual([]);
    expect(parsed.config?.laneHosts).toEqual([]);
    expect(parsed.config?.seats).toEqual([]);
  });
});
