import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  ANCHORS_BIN,
  DASH_ABSENT,
  GIT_SHIM_NO_DIFF,
  VERIFY_BIN,
  forEachShell,
  makeRepo,
  runScript,
  type Repo,
} from "./harness.js";

/**
 * `bin/verify-manifests`, end to end.
 *
 * The source shipped with no test file, so every case here is new. Each is
 * asserted by its EXIT CODE and by the exact message, because a gate that
 * fails quietly has stopped being one: an exit code alone cannot tell "found
 * nothing to do" from "could not look and said nothing", which is the precise
 * failure this script exists to prevent.
 */

const dirs: string[] = [];
const repo = (): Repo => {
  const made = makeRepo();
  dirs.push(made.root);
  return made;
};

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  // Both bins the script invokes. If either is missing, every case below would
  // be measuring a stub, so this fails before any of them run.
  for (const bin of [ANCHORS_BIN, VERIFY_BIN])
    expect(existsSync(bin), `${bin} — run \`yarn build\` first`).toBe(true);
});

describe("no manifests directory", () => {
  forEachShell(
    "1. a repository with no .agents/manifests reports it and exits 0",
    (shell) => {
      const r = repo();
      r.write("README.md", "# a repository\n");
      r.commit("first");

      const result = runScript(shell.command, r, { cwd: r.root });

      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toBe(
        "verify-manifests: no .agents/manifests directory; nothing to replay\n",
      );
      // Nothing was replayed, and nothing was even listed.
      expect(r.shimLog()).toEqual([]);
    },
  );
});

describe("the repository root, not the cwd", () => {
  forEachShell(
    "2. started below the root, it finds the manifests at the root",
    (shell) => {
      const r = repo();
      r.commitManifest();
      const base = r.commit("seed");
      r.remote("main", base);
      r.touch("notes/unrelated.md");
      r.commit("an unrelated change");
      // A directory the caller might plausibly be standing in, which must NOT
      // decide the answer.
      r.subdir("packages", "deep", "er");

      const result = runScript(shell.command, r, {
        cwd: join(r.root, "packages", "deep", "er"),
      });
      const out = `${result.stdout}${result.stderr}`;

      // The check really ran, against the ROOT's directory, over the root's file.
      expect(r.shimLog(), out).toEqual([
        "hexagen-orchestration-mutate-anchors .agents/manifests",
      ]);
      expect(out, out).not.toContain("no .agents/manifests directory");
      expect(out, out).not.toContain("cannot list");
      // The root's one manifest was counted: a check that ran against some other
      // directory could not print this.
      expect(result.stdout, out).toContain("1 manifest(s)");
      expect(result.status, out).toBe(0);
      expect(result.stdout, out).toContain(
        "verify-manifests: no manifest changed against origin/main; nothing to replay",
      );
    },
  );
});

describe("a dead anchor", () => {
  forEachShell(
    "3. a manifest whose before-text no longer occurs fails, exit 1",
    (shell) => {
      const r = repo();
      // The file exists and holds the before-text ZERO times. No `-t`, so the
      // pattern stage has nothing to say and the anchor is the only fault.
      r.write("src/gate.ts", "const gate = true;\n\nexport { gate };\n");
      r.manifest({ before: "const gate = gone;" });
      const base = r.commit("seed");
      r.remote("main", base);
      // Second commit changes something that is NOT a manifest, so the anchor
      // check is the only stage that can fail.
      r.touch("notes/unrelated.md");
      const head = r.commit("unrelated");
      expect(head).not.toBe(base);

      const result = runScript(shell.command, r, { cwd: r.root });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(1);
      expect(result.stderr).toContain(
        "verify-manifests: a mutation anchor no longer resolves",
      );
      expect(result.stdout, out).toContain("DEAD ANCHOR");
      // It never reached the diff: nothing to replay is not what happened.
      expect(result.stdout, out).not.toContain("nothing to replay");
    },
  );
});

describe("the diff base", () => {
  /** A repository whose manifests are committed in the first commit, then `base` remoted. */
  const seeded = (): { r: Repo; base: string } => {
    const r = repo();
    r.commitManifest();
    const base = r.commit("seed");
    r.remote("main", base);
    r.touch("notes/unrelated.md");
    r.commit("an unrelated change, not a manifest");
    return { r, base };
  };

  forEachShell("4. GITHUB_BASE_REF is the base when it is set", (shell) => {
    const r = repo();
    r.commitManifest();
    r.touch("notes/on-feature.md");
    const feature = r.commit("the feature branch's tip");
    r.touch("notes/on-main.md");
    const base = r.commit("the main branch's tip");
    r.remote("main", base);
    r.remote("feature", feature);
    r.touch("notes/unrelated.md");
    r.commit("an unrelated change");

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { GITHUB_BASE_REF: "feature" },
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain(
      "verify-manifests: no manifest changed against origin/feature; nothing to replay",
    );
    expect(result.stdout, out).not.toContain("origin/main");
  });

  forEachShell(
    "5. MANIFEST_DIFF_BASE is the base when GITHUB_BASE_REF is unset",
    (shell) => {
      const { r, base } = seeded();

      const result = runScript(shell.command, r, {
        cwd: r.root,
        env: { MANIFEST_DIFF_BASE: base },
      });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(0);
      expect(result.stdout).toContain(
        `verify-manifests: no manifest changed against ${base}; nothing to replay`,
      );
    },
  );

  forEachShell(
    "6. an all-zero MANIFEST_DIFF_BASE falls through to the default",
    (shell) => {
      const { r } = seeded();

      const result = runScript(shell.command, r, {
        cwd: r.root,
        env: { MANIFEST_DIFF_BASE: "0".repeat(40) },
      });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(0);
      expect(out, out).not.toContain("falling back");
      expect(result.stdout).toContain(
        "verify-manifests: no manifest changed against origin/main; nothing to replay",
      );
    },
  );

  forEachShell("7. a malformed base is refused, not guessed at", (shell) => {
    const { r } = seeded();
    const value = `z${"0".repeat(39)}`;

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { MANIFEST_DIFF_BASE: value },
    });

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(
      `verify-manifests: base '${value}' is not a resolvable commit — refusing to guess`,
    );
    expect(result.stdout + result.stderr).not.toContain("falling back");
  });

  forEachShell(
    "8a. a rewritten base with no origin/$MAIN is refused",
    (shell) => {
      const r = repo();
      r.commitManifest();
      r.touch("notes/unrelated.md");
      r.commit("an unrelated change, not a manifest");
      // `origin/main` deliberately absent, so the fallback has nowhere to land.

      const result = runScript(shell.command, r, {
        cwd: r.root,
        env: { MANIFEST_DIFF_BASE: "a".repeat(40) },
      });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(2);
      expect(result.stderr).toContain(
        "verify-manifests: origin/main is unreachable too — refusing to call that no changes",
      );
    },
  );

  forEachShell("8b. a rewritten base falls back to origin/$MAIN", (shell) => {
    const { r } = seeded();

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { MANIFEST_DIFF_BASE: "a".repeat(40) },
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain("falling back");
    expect(result.stdout).toContain(
      "verify-manifests: no manifest changed against origin/main; nothing to replay",
    );
  });

  forEachShell("9a. a base that is HEAD steps back to HEAD~1", (shell) => {
    const r = repo();
    r.commitManifest();
    r.touch("notes/first.md");
    r.commit("the first commit");
    r.touch("notes/second.md");
    // `origin/main` IS HEAD: a force-push, where diffing HEAD against itself
    // would find nothing and skip every manifest in silence.
    const head = r.commit("the second commit");
    r.remote("main", head);

    const result = runScript(shell.command, r, { cwd: r.root });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain(
      "verify-manifests: base resolves to HEAD; using HEAD~1 so the diff is not empty by construction",
    );
    // The base that was actually diffed, not only the notice that announced it.
    expect(result.stdout, out).toContain(
      "verify-manifests: no manifest changed against HEAD~1",
    );
  });

  forEachShell("9b. a base that is HEAD with no parent is refused", (shell) => {
    const r = repo();
    r.commitManifest();
    const only = r.commit("the only commit");
    r.remote("main", only);

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { GITHUB_BASE_REF: "main" },
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(2);
    expect(result.stderr).toContain(
      "verify-manifests: base resolves to HEAD and there is no parent — refusing to call that no changes",
    );
  });

  forEachShell(
    "10. a diff that cannot run is refused, not called 'no changes'",
    (shell) => {
      const { r, base } = seeded();

      const result = runScript(shell.command, r, {
        cwd: r.root,
        env: { MANIFEST_DIFF_BASE: base },
        gitShim: GIT_SHIM_NO_DIFF,
      });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(2);
      expect(result.stderr.trim()).toBe(
        `verify-manifests: cannot diff against '${base}' — refusing to call that no changes`,
      );
    },
  );
});

describe("replaying what changed", () => {
  forEachShell(
    "11. one failing replay still attempts the other, then exits 1",
    (shell) => {
      const r = repo();
      // Both manifests anchor into the same live file exactly once, and neither
      // carries a `-t`, so the anchor stage passes and both reach the replay.
      const staysGreen = [process.execPath, "-e", "process.exit(0)"];
      const goesRed = [
        process.execPath,
        "-e",
        'const fs = require("node:fs"); process.exit(fs.readFileSync("src/gate.ts", "utf8").includes("const gate = false;") ? 1 : 0);',
      ];
      r.write("src/gate.ts", "const gate = true;\n\nexport { gate };\n");
      r.manifest({ name: "a-mismatch.json", command: staysGreen });
      r.manifest({ name: "b-caught.json", command: goesRed });
      const base = r.commit("seed");
      r.remote("main", base);
      // Both manifests change in the second commit, so both are in the diff. The
      // change is the stated reason, not the claim: a manifest whose file, texts
      // and command are untouched is a manifest whose claim is untouched, and
      // rewriting the reason is the honest way to make the file differ.
      r.manifest({
        name: "a-mismatch.json",
        command: staysGreen,
        because: "the guard must go red, restated",
      });
      r.manifest({
        name: "b-caught.json",
        command: goesRed,
        because: "the guard must go red, restated",
      });
      r.commit("restate both manifests");

      const result = runScript(shell.command, r, { cwd: r.root });
      const out = `${result.stdout}${result.stderr}`;

      expect(result.status, out).toBe(1);
      // Both were attempted: a failure must not abandon the rest.
      expect(r.shimLog(), out).toEqual([
        "hexagen-orchestration-mutate-anchors .agents/manifests",
        "hexagen-orchestration-mutate-verify .agents/manifests/a-mismatch.json",
        "hexagen-orchestration-mutate-verify .agents/manifests/b-caught.json",
      ]);
      expect(result.stderr, out).toContain(
        "verify-manifests: .agents/manifests/a-mismatch.json did not reproduce",
      );
      expect(result.stderr, out).not.toContain(
        "b-caught.json did not reproduce",
      );
      expect(result.stdout, out).toContain(
        "verify-manifests: replaying .agents/manifests/b-caught.json",
      );
    },
  );

  forEachShell("12. no changed manifest says so and exits 0", (shell) => {
    const r = repo();
    r.commitManifest();
    const base = r.commit("seed");
    r.remote("main", base);
    r.write(
      "src/gate.ts",
      "const gate = true;\n\n// touched\nexport { gate };\n",
    );
    r.commit("touch a source file, not a manifest");

    const result = runScript(shell.command, r, { cwd: r.root });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain(
      "verify-manifests: no manifest changed against origin/main; nothing to replay",
    );
    expect(r.shimLog(), out).toEqual([
      "hexagen-orchestration-mutate-anchors .agents/manifests",
    ]);
  });

  forEachShell("13. MAIN_BRANCH names the default branch", (shell) => {
    const r = repo();
    r.commitManifest();
    const base = r.commit("seed");
    r.remote("trunk", base);
    // `origin/main` is absent: nothing but MAIN_BRANCH can name `origin/trunk`.
    r.touch("notes/unrelated.md");
    r.commit("an unrelated change");

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { MAIN_BRANCH: "trunk" },
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain(
      "verify-manifests: no manifest changed against origin/trunk; nothing to replay",
    );
  });

  forEachShell("13. MAIN_BRANCH names the fallback too", (shell) => {
    const r = repo();
    r.commitManifest();
    const base = r.commit("seed");
    r.remote("trunk", base);
    r.touch("notes/unrelated.md");
    r.commit("an unrelated change");

    const result = runScript(shell.command, r, {
      cwd: r.root,
      env: { MAIN_BRANCH: "trunk", MANIFEST_DIFF_BASE: "a".repeat(40) },
    });
    const out = `${result.stdout}${result.stderr}`;

    expect(result.status, out).toBe(0);
    expect(result.stdout).toContain("falling back");
    expect(result.stdout).toContain(
      "verify-manifests: no manifest changed against origin/trunk; nothing to replay",
    );
  });
});

describe("the shells this ran under", () => {
  test("dash is exercised, or its absence is on the record", () => {
    // A run that only ever saw /bin/sh would prove nothing about the shell
    // whose `read -d` bug the source's own header names, so this runs the
    // script under dash explicitly rather than relying on the suite loop.
    if (DASH_ABSENT) {
      expect(
        DASH_ABSENT,
        "no dash on this machine: every dash case above is reported as skipped",
      ).toBe(true);
      return;
    }
    const r = repo();
    r.write("README.md", "# a repository\n");
    r.commit("first");
    const result = runScript("/bin/dash", r, { cwd: r.root });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
