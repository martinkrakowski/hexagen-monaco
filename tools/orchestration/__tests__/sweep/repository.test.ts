import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../../src/sweep/cli.js";
import { THREADS_QUERY } from "../../src/sweep/lib/sweep.js";
import { parseRepoRef, repoFlag } from "../../src/sweep/lib/types.js";
import { REPO, harness } from "./support.js";
import { FOREIGN_OWNER, FOREIGN_REPO } from "./foreign-literals.js";

/**
 * A-8: the repository.
 *
 * The source's `THREADS_QUERY` named one repository in the query text and every
 * other `gh` call inherited the working directory, so a packaged sweep asked the
 * wrong forge about every PR it was handed. Here ONE `owner`/`name` pair comes
 * from the project's overlay and reaches every call.
 *
 * `acme/demo` is the pair these tests assert against: a second repository name,
 * so a hardcoded one would be visible in every recorded argv.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A healthy one-page answer, whatever the command asked for. */
const page = (node: { id: string; isResolved: boolean }): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_I_1",
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [node],
          },
        },
      },
    },
  });

/** A run list carrying one run on the PR's own head. */
const runList = (id: number): string =>
  JSON.stringify([
    { databaseId: id, headSha: "sha-this-pr", event: "pull_request" },
  ]);

/** A job log with no model response in it. */
const emptyLog = "PR-Agent review\tUNKNOWN STEP\t2026-09-14T20:45:58.000Z {}\n";

describe("the repository every gh call is pointed at", () => {
  /** Every `gh` argv one full `attribute` run makes, through a recording stub. */
  const attributeRun = async (): Promise<string[][]> => {
    const calls: string[][] = [];
    const h = harness({
      argv: ["attribute", "--pr", "401"],
      gh: async (args) => {
        calls.push([...args]);
        if (args[0] === "api")
          return page({ id: "PRRT_api", isResolved: true });
        if (args[0] === "pr") {
          const at = args.indexOf("--json");
          const fields = at >= 0 ? String(args[at + 1] ?? "") : "";
          return fields.includes("commits")
            ? JSON.stringify({
                headRefName: "feat/x",
                commits: [{ oid: "sha-this-pr" }],
              })
            : "feat/x\n";
        }
        if (args[0] === "run" && args[1] === "list") return runList(1);
        return emptyLog;
      },
    });
    const code = await runCli(h.io);
    expect(code, h.err.join("\n")).toBe(0);
    return calls;
  };

  test("a full run passes owner=acme and name=demo", async () => {
    const calls = await attributeRun();
    const fetch = calls.find((c) => c.some((a) => a.includes("SweepThreads")))!;
    expect(fetch).toContain("owner=acme");
    expect(fetch).toContain("name=demo");
  });

  test("every recorded gh argv names the repository, as a flag or as the query's variables", async () => {
    const calls = await attributeRun();
    expect(calls.length).toBeGreaterThan(4);
    for (const argv of calls) {
      const named =
        argv.includes("--repo") ||
        (argv.includes("owner=acme") && argv.includes("name=demo"));
      expect(named, argv.join(" ")).toBe(true);
    }
    // And the flag is the ONE repository, never two.
    for (const argv of calls) {
      const at = argv.indexOf("--repo");
      if (at >= 0) expect(argv[at + 1]).toBe("acme/demo");
    }
  });

  test("the query text names neither a specific owner nor a specific repository", () => {
    expect(THREADS_QUERY).not.toContain(FOREIGN_OWNER);
    expect(THREADS_QUERY).not.toContain(FOREIGN_REPO);
    // It declares the two halves instead, so the repository is an input.
    expect(THREADS_QUERY).toContain("$owner: String!");
    expect(THREADS_QUERY).toContain("$name: String!");
    expect(THREADS_QUERY).toContain("repository(owner: $owner, name: $name)");
  });

  test("a second repository flows through unchanged — nothing is pinned to acme/demo", async () => {
    const other = { owner: "globex", name: "rollup" };
    const calls: string[][] = [];
    const h = harness({
      argv: ["attribute", "--pr", "401"],
      repo: other,
      gh: async (args) => {
        calls.push([...args]);
        if (args[0] === "api")
          return page({ id: "PRRT_api", isResolved: true });
        if (args[0] === "pr") {
          const at = args.indexOf("--json");
          const fields = at >= 0 ? String(args[at + 1] ?? "") : "";
          return fields.includes("commits")
            ? JSON.stringify({
                headRefName: "feat/x",
                commits: [{ oid: "sha-this-pr" }],
              })
            : "feat/x\n";
        }
        if (args[0] === "run" && args[1] === "list") return runList(1);
        return emptyLog;
      },
    });
    expect(await runCli(h.io)).toBe(0);
    for (const argv of calls) {
      const at = argv.indexOf("--repo");
      if (at >= 0) expect(argv[at + 1]).toBe("globex/rollup");
      if (argv.includes("owner=")) expect(argv).toContain("owner=globex");
      if (argv.includes("name=")) expect(argv).toContain("name=rollup");
    }
  });

  test("the disposition mutation names the repository too, so a class is never posted elsewhere", async () => {
    const calls: string[][] = [];
    const h = harness({
      argv: [
        "threads",
        "--pr",
        "361",
        "--thread",
        "PRRT_a",
        "--body",
        "x",
        "--post",
      ],
      gh: async (args) => {
        calls.push([...args]);
        if (args.some((a) => a.includes("mutation"))) {
          return JSON.stringify({
            data: {
              addComment: { comment: { url: "https://gh/c" } },
              resolve0: { thread: { isResolved: true } },
            },
          });
        }
        return page({ id: "PRRT_a", isResolved: false });
      },
    });
    expect(await runCli(h.io)).toBe(0);
    const write = calls.find((c) => c.some((a) => a.includes("mutation")))!;
    expect(write[write.indexOf("--repo") + 1]).toBe("acme/demo");
  });
});

describe("parseRepoRef", () => {
  test("owner/name becomes the two halves", () => {
    expect(parseRepoRef("acme/demo")).toEqual({ owner: "acme", name: "demo" });
  });

  test("a name containing a dot or a dash is kept whole", () => {
    expect(parseRepoRef("acme/my.repo-2")).toEqual({
      owner: "acme",
      name: "my.repo-2",
    });
  });

  test.each([
    ["absent", undefined],
    ["empty", ""],
    ["no slash", "demo"],
    ["empty owner", "/demo"],
    ["empty name", "acme/"],
    ["two slashes", "acme/demo/extra"],
    ["whitespace", "acme /demo"],
  ])("a repository that is %s is refused", (_label, repo) => {
    expect(parseRepoRef(repo)).toBeUndefined();
  });

  test("repoFlag is the pair as the flag takes it", () => {
    expect(repoFlag(REPO)).toBe("acme/demo");
  });
});

/**
 * The bin, at its own entry: the repository refusal, the overlay refusal, and
 * the `repo` setting travelling all the way into a command.
 */
describe("the built bin", () => {
  const bin = (): string => resolve(PACKAGE_ROOT, "dist/bins/sweep.js");

  /** A git repository with the given overlay text (absent when undefined). */
  const repository = (config?: string): string => {
    const root = mkdtempSync(join(tmpdir(), "sweep-repo-"));
    dirs.push(root);
    expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
    if (config !== undefined) {
      mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
      writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
    }
    return root;
  };

  const run = (
    cwd: string,
    args: readonly string[],
    stdin = "",
    env: Record<string, string> = {},
  ) =>
    spawnSync(process.execPath, [bin(), ...args], {
      cwd,
      encoding: "utf8",
      input: stdin,
      env: { ...process.env, ...env },
    });

  test("with no repository the bin refuses with 2, naming `repo`, and calls nothing", () => {
    // No overlay and no `gh` answer: there is no repository to point at.
    const root = repository();
    const result = run(root, ["append-only", "CHANGELOG.md"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("repo");
    expect(result.stdout).toBe("");
  });

  test("a present overlay with problems refuses before any command runs", () => {
    const root = repository("repo: acme/demo\nnope: 1\n");
    const result = run(root, ["config", "requiredCheck"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
    expect(result.stdout).toBe("");
  });

  test("the overlay's repository and requiredCheck reach `config` from a subdirectory", () => {
    const root = repository("repo: acme/demo\nrequiredCheck: ^Deploy\n");
    const sub = join(root, "packages", "deep");
    mkdirSync(sub, { recursive: true });
    const result = run(sub, ["config", "requiredCheck"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("^Deploy");
  });

  test("a caller-exported APPEND_ONLY reaches `append-only` from the environment", () => {
    const root = repository(
      "repo: acme/demo\nappendOnlyPaths: ^CHANGELOG\\.md$\n",
    );
    // The overlay's own pattern: the changelog is append-only, nothing else is.
    expect(run(root, ["append-only", "CHANGELOG.md"]).status).toBe(0);
    expect(run(root, ["append-only", "src/a.ts"]).status).toBe(1);
    // A caller that exports its own pattern overrides the overlay's, and an
    // EMPTY export does not — POSIX `${VAR:-word}` semantics, not `??`'s.
    expect(
      run(root, ["append-only", "src/a.ts"], "", { APPEND_ONLY: "^src/" })
        .status,
    ).toBe(0);
    expect(
      run(root, ["append-only", "src/a.ts"], "", { APPEND_ONLY: "" }).status,
    ).toBe(1);
  });

  test("a caller-exported REQUIRED_CHECK reaches `config requiredCheck`", () => {
    const root = repository("repo: acme/demo\nrequiredCheck: ^Build\n");
    expect(run(root, ["config", "requiredCheck"]).stdout.trim()).toBe("^Build");
    expect(
      run(root, ["config", "requiredCheck"], "", {
        REQUIRED_CHECK: "^Deploy",
      }).stdout.trim(),
    ).toBe("^Deploy");
    expect(
      run(root, ["config", "requiredCheck"], "", {
        REQUIRED_CHECK: "",
      }).stdout.trim(),
    ).toBe("^Build");
  });

  test("`checks` reads stdin and prints one line", () => {
    const root = repository("repo: acme/demo\n");
    const result = run(
      root,
      ["checks"],
      JSON.stringify([
        { n: "Build", s: "completed", c: "success" },
        { n: "Lint", s: "queued", c: null },
      ]),
    );
    expect(result.status).toBe(0);
    // The queued run has no conclusion yet, and "no conclusion" is not one of the
    // three acceptable answers — so it is named.
    expect(result.stdout).toBe("pending=1 required=1 bad=Lint\n");
  });

  test("malformed stdin exits 2 with nothing on stdout", () => {
    const root = repository("repo: acme/demo\n");
    const result = run(root, ["checks"], "not json");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });

  test("`keep-both` accepts an absolute path and keeps it, from any working directory", () => {
    // `resolve(root, abs)` returns `abs`: the merge script hands the resolver an
    // absolute path because it may run from a worktree that is not the root.
    const root = repository("repo: acme/demo\n");
    const elsewhere = mkdtempSync(join(tmpdir(), "sweep-elsewhere-"));
    dirs.push(elsewhere);
    const file = join(elsewhere, "f.txt");
    writeFileSync(file, "<<<<<<< HEAD\no\n=======\nt\n>>>>>>> origin/main\n");
    const result = run(root, ["keep-both", file]);
    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("o\nt\n");
  });

  test("`keep-both` resolves a file under the repository root, not the working directory", () => {
    const root = repository("repo: acme/demo\n");
    writeFileSync(
      join(root, "f.txt"),
      "<<<<<<< HEAD\no\n=======\nt\n>>>>>>> origin/main\n",
    );
    const sub = join(root, "packages", "deep");
    mkdirSync(sub, { recursive: true });
    const result = run(sub, ["keep-both", "f.txt"]);
    expect(result.status).toBe(0);
    expect(run(root, ["config", "requiredCheck"]).status).toBe(0);
    expect(
      spawnSync("cat", [join(root, "f.txt")], { encoding: "utf8" }).stdout,
    ).toBe("o\nt\n");
  });
});
