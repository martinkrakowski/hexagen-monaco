import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type SweepEnv } from "../../src/sweep/cli.js";
import { configFor, harness } from "./support.js";

/**
 * The four commands `bin/merge-prs` calls.
 *
 * At the source these were a shell script's own patterns and four separate
 * interpreter invocations, so a pattern change meant editing a zsh string and
 * none of it was testable without a shell. Here each is a command with its own
 * exit codes, and every one of them is exercised without zsh.
 */

const dirs: string[] = [];
/** A throwaway root, so nothing writes into the package tree. */
const tempRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-sub-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("keep-both", () => {
  /** The shape git writes: ours, then theirs, each ending in a newline. */
  const conflicted = (ours: string, theirs: string): string =>
    `before\n<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> origin/main\nafter\n`;

  const run = async (
    contents: string,
  ): Promise<{ code: number; err: string; onDisk: string }> => {
    const root = tempRoot();
    writeFileSync(join(root, "f.txt"), contents);
    const h = harness({
      argv: ["keep-both", "f.txt"],
      root,
      readFile: (path) =>
        Promise.resolve(readFileSync(join(root, path), "utf8")),
      writeFile: (path, text) => {
        writeFileSync(join(root, path), text, "utf8");
        return Promise.resolve();
      },
    });
    const code = await runCli(h.io);
    return {
      code,
      err: h.err.join("\n"),
      onDisk: readFileSync(join(root, "f.txt"), "utf8"),
    };
  };

  test("one hunk resolves to ours then theirs, in that order", async () => {
    const { code, onDisk } = await run(
      conflicted("ours-line\n", "theirs-line\n"),
    );
    expect(code).toBe(0);
    expect(onDisk).toBe("before\nours-line\ntheirs-line\nafter\n");
  });

  test("two hunks in one file both resolve, in file order", async () => {
    const two = [
      "one\n",
      "<<<<<<< HEAD\n",
      "a-ours\n",
      "=======\n",
      "a-theirs\n",
      ">>>>>>> origin/main\n",
      "middle\n",
      "<<<<<<< HEAD\n",
      "b-ours\n",
      "=======\n",
      "b-theirs\n",
      ">>>>>>> origin/main\n",
      "two\n",
    ].join("");
    const { code, onDisk } = await run(two);
    expect(code).toBe(0);
    expect(onDisk).toBe(
      "one\na-ours\na-theirs\nmiddle\nb-ours\nb-theirs\ntwo\n",
    );
  });

  test("a hunk spanning several lines keeps every line of both sides", async () => {
    const { code, onDisk } = await run(conflicted("o1\no2\n", "t1\nt2\n"));
    expect(code).toBe(0);
    expect(onDisk).toBe("before\no1\no2\nt1\nt2\nafter\n");
  });

  test("a file with no markers exits 1 and is left byte-identical", async () => {
    const original = "no markers here\n";
    const { code, err, onDisk } = await run(original);
    expect(code).toBe(1);
    expect(err).toContain("keep-both resolver made no progress on f.txt");
    expect(onDisk).toBe(original);
  });

  test("a nested marker inside a hunk exits 1 and writes nothing", async () => {
    // The resolver's own guard: the result still carries `<<<<<<<`, so what it
    // would have written is a file no human can resolve by hand either.
    const nested =
      "<<<<<<< HEAD\n<<<<<<< HEAD\no\n=======\nt\n>>>>>>> origin/main\n";
    const { code, err, onDisk } = await run(nested);
    expect(code).toBe(1);
    expect(err).toContain("made no progress on f.txt");
    expect(onDisk).toBe(nested);
  });

  test("an unterminated hunk exits 1 and writes nothing", async () => {
    const unterminated = "<<<<<<< HEAD\no\n=======\nt\n";
    const { code, onDisk } = await run(unterminated);
    expect(code).toBe(1);
    expect(onDisk).toBe(unterminated);
  });

  test("a file that cannot be read exits 1, naming the file", async () => {
    const root = tempRoot();
    const h = harness({ argv: ["keep-both", "absent.txt"], root });
    const code = await runCli(h.io);
    expect(code).toBe(1);
    expect(h.err.join("\n")).toContain("could not read absent.txt");
  });

  test("no file argument exits 2 with the usage, and reads nothing", async () => {
    const h = harness({ argv: ["keep-both"] });
    expect(await runCli(h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("hexagen-orchestration-sweep");
  });
});

describe("append-only", () => {
  const run = async (
    paths: readonly string[],
    over: { env?: SweepEnv; config?: ReturnType<typeof configFor> } = {},
  ) => {
    const h = harness({ argv: ["append-only", ...paths] }, over.env ?? {});
    const code = await runCli({
      ...h.io,
      ...(over.config === undefined ? {} : { config: over.config }),
    });
    return { code, err: h.err.join("\n") };
  };

  const withPattern = (appendOnlyPaths?: string) =>
    configFor(appendOnlyPaths === undefined ? {} : { appendOnlyPaths });

  test("every path matching the overlay's pattern exits 0", async () => {
    const { code, err } = await run(["CHANGELOG.md", "notes/session.md"], {
      config: withPattern("^(CHANGELOG\\.md|notes/session\\.md)$"),
    });
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  test("one path not matching exits 1 and names it", async () => {
    const { code, err } = await run(["CHANGELOG.md", "src/a.ts"], {
      config: withPattern("^CHANGELOG\\.md$"),
    });
    expect(code).toBe(1);
    expect(err).toContain("src/a.ts is not an append-only path");
    expect(err).not.toContain("CHANGELOG.md");
  });

  test("with no pattern at all, every path is refused — an empty pattern matches nothing", async () => {
    const { code, err } = await run(["CHANGELOG.md"], {
      config: withPattern(),
    });
    expect(code).toBe(1);
    expect(err).toContain("CHANGELOG.md is not an append-only path");
  });

  test("an empty pattern is treated as no pattern, not as the regex that matches everything", async () => {
    const { code } = await run(["src/a.ts"], { config: withPattern("") });
    expect(code).toBe(1);
  });

  test("a caller-exported APPEND_ONLY overrides the overlay's pattern", async () => {
    const { code } = await run(["src/a.ts"], {
      env: { APPEND_ONLY: "^src/" },
      config: withPattern("^CHANGELOG\\.md$"),
    });
    expect(code).toBe(0);
  });

  test("an empty APPEND_ONLY does not override the overlay's pattern", async () => {
    const { code } = await run(["CHANGELOG.md"], {
      env: { APPEND_ONLY: "" },
      config: withPattern("^CHANGELOG\\.md$"),
    });
    expect(code).toBe(0);
    const refused = await run(["src/a.ts"], {
      env: { APPEND_ONLY: "" },
      config: withPattern("^CHANGELOG\\.md$"),
    });
    expect(refused.code).toBe(1);
  });

  test("an APPEND_ONLY that will not compile matches nothing", async () => {
    // The shell test this replaces failed to match on an invalid expression
    // too, and the caller's answer to "no match" is to die.
    const { code } = await run(["src/a.ts"], { env: { APPEND_ONLY: "[" } });
    expect(code).toBe(1);
  });

  test("no path at all exits 2 with the usage", async () => {
    const { code, err } = await run([]);
    expect(code).toBe(2);
    expect(err).toContain("at least one path");
  });
});

describe("checks", () => {
  const runs = (
    ...specs: readonly (readonly [string, string, string])[]
  ): string => JSON.stringify(specs.map(([n, s, c]) => ({ n, s, c })));

  const run = async (
    stdin: string,
    over: { env?: SweepEnv; config?: ReturnType<typeof configFor> } = {},
  ) => {
    const h = harness(
      { argv: ["checks"], readStdin: async () => stdin },
      over.env ?? {},
    );
    const code = await runCli({
      ...h.io,
      ...(over.config === undefined ? {} : { config: over.config }),
    });
    return { code, out: h.log.join("\n"), err: h.err.join("\n") };
  };

  test("prints exactly one line: pending, required and bad", async () => {
    const { code, out } = await run(
      runs(
        ["Build", "completed", "success"],
        ["Lint", "completed", "success"],
        ["Style", "in_progress", ""],
      ),
    );
    expect(code).toBe(0);
    expect(out).toBe("pending=1 required=1 bad=Style");
  });

  test("pending counts every run whose status is not completed", async () => {
    const { out } = await run(
      runs(
        ["Build", "completed", "success"],
        ["Lint", "queued", ""],
        ["Style", "in_progress", ""],
      ),
    );
    expect(out).toContain("pending=2");
  });

  test("required searches the name, so `^Build` also counts a suffixed check", async () => {
    const { out } = await run(
      runs(
        ["Build", "completed", "success"],
        ["Build and lint", "completed", "success"],
        ["Lint", "completed", "success"],
      ),
    );
    expect(out).toContain("required=2");
  });

  test("bad lists only runs outside success, neutral and skipped", async () => {
    const { out } = await run(
      runs(
        ["Build", "completed", "success"],
        ["Neutral", "completed", "neutral"],
        ["Skipped", "completed", "skipped"],
        ["TimedOut", "completed", "timed_out"],
        ["Failed", "completed", "failure"],
        ["Cancelled", "completed", "cancelled"],
      ),
    );
    expect(out).toContain("bad=TimedOut,Failed,Cancelled");
  });

  test("bad is present and empty when every conclusion is acceptable", async () => {
    const { out } = await run(runs(["Build", "completed", "success"]));
    expect(out).toBe("pending=0 required=1 bad=");
  });

  test("an empty array is zero of everything, not a malformed payload", async () => {
    const { code, out } = await run("[]");
    expect(code).toBe(0);
    expect(out).toBe("pending=0 required=0 bad=");
  });

  test("the required pattern comes from the overlay", async () => {
    const { out } = await run(runs(["Deploy", "completed", "success"]), {
      config: configFor({ requiredCheck: "^Deploy" }),
    });
    expect(out).toContain("required=1");
  });

  test("a non-empty REQUIRED_CHECK in the environment overrides the overlay", async () => {
    const { out } = await run(
      runs(
        ["Build", "completed", "success"],
        ["Deploy", "completed", "success"],
      ),
      {
        env: { REQUIRED_CHECK: "^Deploy" },
        config: configFor({ requiredCheck: "^Build" }),
      },
    );
    expect(out).toContain("required=1");
    expect(out).not.toContain("required=2");
  });

  test("an empty REQUIRED_CHECK does not override the overlay", async () => {
    const { out } = await run(runs(["Build", "completed", "success"]), {
      env: { REQUIRED_CHECK: "" },
    });
    expect(out).toContain("required=1");
  });

  test("a required pattern that will not compile exits 2 and prints nothing", async () => {
    const { code, out, err } = await run(
      runs(["Build", "completed", "success"]),
      {
        config: configFor({ requiredCheck: "(" }),
      },
    );
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toMatch(/not a valid regular expression/);
  });

  test.each([
    ["not JSON", "nope"],
    ["an object", "{}"],
    ["a string", '"runs"'],
    ["a row that is not an object", "[1]"],
    ["a row with no name", '[{"s":"completed","c":"success"}]'],
    ["a row with no status", '[{"n":"Build","c":"success"}]'],
    ["a row with no conclusion", '[{"n":"Build","s":"completed"}]'],
    [
      "a row whose conclusion is a number",
      '[{"n":"Build","s":"completed","c":1}]',
    ],
    ["a truncated payload", '[{"n":"Build","s":"comp'],
  ])(
    "malformed input (%s) exits 2 and prints nothing on stdout",
    async (_label, stdin) => {
      const { code, out, err } = await run(stdin);
      expect(code).toBe(2);
      expect(out).toBe("");
      expect(err.length).toBeGreaterThan(0);
    },
  );

  test("an argument instead of stdin exits 2 with the usage", async () => {
    const h = harness({ argv: ["checks", "runs.json"] });
    expect(await runCli(h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("on stdin");
  });
});

describe("config", () => {
  test("requiredCheck prints the overlay's own value", async () => {
    const h = harness({
      argv: ["config", "requiredCheck"],
      config: configFor({ requiredCheck: "^Deploy" }),
    });
    expect(await runCli(h.io)).toBe(0);
    expect(h.log).toEqual(["^Deploy"]);
  });

  test("requiredCheck defaults to the package default when the overlay is silent", async () => {
    const h = harness({ argv: ["config", "requiredCheck"] });
    expect(await runCli(h.io)).toBe(0);
    expect(h.log).toEqual(["^Build"]);
  });

  test("a caller-exported REQUIRED_CHECK is the resolved value, so the script reads one number", async () => {
    const h = harness(
      { argv: ["config", "requiredCheck"] },
      { REQUIRED_CHECK: "^Deploy" },
    );
    expect(await runCli(h.io)).toBe(0);
    expect(h.log).toEqual(["^Deploy"]);
  });

  test("an empty REQUIRED_CHECK leaves the overlay's value resolved", async () => {
    const h = harness(
      { argv: ["config", "requiredCheck"] },
      { REQUIRED_CHECK: "" },
    );
    expect(await runCli(h.io)).toBe(0);
    expect(h.log).toEqual(["^Build"]);
  });

  test("a field this command cannot answer exits 2", async () => {
    const h = harness({ argv: ["config", "planDir"] });
    expect(await runCli(h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("no field 'planDir'");
  });

  test("no field at all exits 2 with the usage", async () => {
    const h = harness({ argv: ["config"] });
    expect(await runCli(h.io)).toBe(2);
    expect(h.err.join("\n")).toContain("exactly one field");
  });
});
