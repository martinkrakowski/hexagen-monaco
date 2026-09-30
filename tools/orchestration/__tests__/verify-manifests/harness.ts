import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { test } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * The harness for `bin/verify-manifests`, which the source had no test for.
 *
 * Three things make a shell gate testable at all, and each of them is a place
 * where a test can quietly stop testing:
 *
 *   1. **`npx` is a PATH shim, not a mock.** It EXECs the built bin named in
 *      its own arguments and never chooses an exit code. A stub that returned
 *      0 for the anchors bin would make every assertion below true for a
 *      script that ran no anchor check at all.
 *   2. **Every run is in a real temporary git repository**, with real commits
 *      and real `refs/remotes/origin/*` refs, because the base-resolution
 *      ladder (`GITHUB_BASE_REF`, `MANIFEST_DIFF_BASE`, `origin/$MAIN`, `HEAD~1`)
 *      is the whole subject.
 *   3. **Every run is under `/bin/sh` AND, when it exists, `dash`** — the two
 *      are not the same shell, and the source's own header names the `read -d`
 *      bug that only `dash` ever showed.
 */

export const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
export const SCRIPT = join(PACKAGE_ROOT, "bin/verify-manifests");
export const ANCHORS_BIN = join(PACKAGE_ROOT, "dist/bins/mutate-anchors.js");
export const VERIFY_BIN = join(PACKAGE_ROOT, "dist/bins/mutate-verify.js");

const REAL_GIT = (() => {
  const found = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  if (found === "") throw new Error("git is not on PATH; these tests need it");
  return found;
})();

const GIT_IDENTITY = [
  "-c",
  "user.email=verify-manifests@example.invalid",
  "-c",
  "user.name=verify-manifests tests",
  "-c",
  "commit.gpgsign=false",
];

/** The scripts under test read these; a test must never inherit the outer values. */
const CLEARED = ["GITHUB_BASE_REF", "MANIFEST_DIFF_BASE", "MAIN_BRANCH"];

export interface Repo {
  /** The repository root. The script `cd`s here, whatever cwd it is given. */
  readonly root: string;
  /** A `PATH` directory holding the `npx` shim. Prepended to the child's PATH. */
  readonly binDir: string;
  /** Every shim invocation, one line per call, `$*` as the shim saw it. */
  shimLog(): readonly string[];
  write(relative: string, content: string): void;
  /**
   * Writes a NEW, never-reused file, so the next `commit` has something to
   * record. A fixture that committed twice without changing anything would get
   * an empty commit, and a repository whose second commit is empty is a
   * different repository as far as a diff-scoped gate is concerned.
   */
  touch(relative: string): void;
  /** Stages everything and commits. Returns the new commit's SHA. */
  commit(message: string): string;
  /** Points `refs/remotes/origin/<name>` at a commit, so `origin/<name>` resolves. */
  remote(name: string, sha: string): void;
  /** A subdirectory of the root, to prove the script is not reading the cwd. */
  subdir(...parts: readonly string[]): string;
  /** A live manifest: its before-text appears exactly once, and no `-t` to break. */
  manifest(options?: {
    readonly name?: string;
    readonly file?: string;
    readonly before?: string;
    readonly after?: string;
    readonly command?: readonly string[];
    /** The claim's stated reason. Changing it changes the file without changing the claim. */
    readonly because?: string;
  }): string;
  commitManifest(options?: Parameters<Repo["manifest"]>[0]): string;
}

export function makeRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), "orchestration-vm-"));
  const binDir = join(root, "shim-bin");
  mkdirSync(binDir, { recursive: true });
  const shimLogPath = join(root, "shim.log");

  const run = (args: readonly string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const expect = (result: SpawnSyncReturns<string>, what: string) => {
    if (result.status !== 0)
      throw new Error(
        `git ${what} failed (${result.status}): ${result.stderr}`,
      );
    return result.stdout.trim();
  };

  // The shim. It logs its arguments, then EXECS the built bin. There is no
  // branch in it that invents a result: the exit code a caller sees is the
  // bin's, which is the only thing these tests are allowed to measure.
  const shim = `#!/bin/sh
# Test shim: execs the built bin named in its arguments. Never decides an exit code.
while [ "$1" = "--no-install" ]; do shift; done
printf '%s\\n' "$*" >> "$VERIFY_MANIFESTS_SHIM_LOG"
case "$1" in
  hexagen-orchestration-mutate-anchors)
    shift
    exec ${JSON.stringify(process.execPath)} ${JSON.stringify(ANCHORS_BIN)} "$@" ;;
  hexagen-orchestration-mutate-verify)
    shift
    exec ${JSON.stringify(process.execPath)} ${JSON.stringify(VERIFY_BIN)} "$@" ;;
  *)
    echo "verify-manifests shim: unexpected command '$1'" >&2
    exit 3 ;;
esac
`;
  const npxPath = join(binDir, "npx");
  writeFileSync(npxPath, shim);
  chmodSync(npxPath, 0o755);

  expect(run(["init", "-q"]), "init");

  return {
    root,
    binDir,
    shimLog: () =>
      existsSync(shimLogPath)
        ? readFileSync(shimLogPath, "utf8")
            .split("\n")
            .filter((l) => l !== "")
        : [],
    write(relative, content) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
    touch(relative) {
      let counter = 0;
      let path = join(root, relative);
      while (existsSync(path)) {
        counter++;
        path = join(root, `${relative}.${counter}`);
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `revision ${counter}\n`, "utf8");
    },
    commit(message) {
      expect(run(["add", "-A"]), "add");
      expect(run([...GIT_IDENTITY, "commit", "-q", "-m", message]), "commit");
      return expect(run(["rev-parse", "HEAD"]), "rev-parse HEAD");
    },
    remote(name, sha) {
      expect(
        run(["update-ref", `refs/remotes/origin/${name}`, sha]),
        `update-ref ${name}`,
      );
    },
    subdir(...parts) {
      const path = join(root, ...parts);
      mkdirSync(path, { recursive: true });
      return path;
    },
    manifest({
      name = "lane.json",
      file = "src/gate.ts",
      before = "const gate = true;",
      after = "const gate = false;",
      command = [process.execPath, "-e", "process.exit(0)"],
      because = "the guard must go red",
    } = {}) {
      const path = `.agents/manifests/${name}`;
      this.write(
        path,
        `${JSON.stringify(
          {
            version: 1,
            lane: "vm1",
            mutations: [
              {
                file,
                before,
                after,
                because,
                command,
                verdict: "caught",
              },
            ],
          },
          null,
          2,
        )}\n`,
      );
      return path;
    },
    commitManifest(options) {
      this.write("src/gate.ts", "const gate = true;\n\nexport { gate };\n");
      return this.manifest(options);
    },
  };
}

export interface RunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** A `git` shim that is consulted before the real one. `null` for none. */
  readonly gitShim?: string | null;
}

/** The script's environment: our PATH first, the outer variables removed. */
export function scriptEnv(
  repo: Repo,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) env[key] = value;
  for (const key of CLEARED) delete env[key];
  env.PATH = `${repo.binDir}:${env.PATH ?? ""}`;
  env.VERIFY_MANIFESTS_SHIM_LOG = join(repo.root, "shim.log");
  return { ...env, ...extra };
}

/** Runs the script with `shell` (a path to `/bin/sh` or `dash`) as its interpreter. */
export function runScript(
  shell: string,
  repo: Repo,
  options: RunOptions,
): SpawnSyncReturns<string> {
  if (options.gitShim !== undefined && options.gitShim !== null) {
    const path = join(repo.binDir, "git");
    writeFileSync(path, options.gitShim);
    chmodSync(path, 0o755);
  }
  return spawnSync(shell, [SCRIPT], {
    cwd: options.cwd,
    encoding: "utf8",
    env: scriptEnv(repo, options.env ?? {}),
  });
}

/**
 * A `git` that refuses `diff` and forwards everything else. The script's one
 * use of `git diff` is the diff that decides what to replay, so this is the
 * only way to reach the fail-open branch the file exists to prevent.
 */
export const GIT_SHIM_NO_DIFF = `#!/bin/sh
if [ "$1" = "diff" ]; then
  echo "git shim: diff refused" >&2
  exit 1
fi
exec ${REAL_GIT} "$@"
`;

/** `/bin/sh` is the script's shebang interpreter; `dash` is what CI runners use. */
export interface Shell {
  readonly label: string;
  readonly command: string;
}

export const SHELLS: readonly Shell[] = [
  { label: "/bin/sh", command: "/bin/sh" },
  ...(existsSync("/bin/dash") ? [{ label: "dash", command: "/bin/dash" }] : []),
];

export const DASH_ABSENT = !existsSync("/bin/dash");

/**
 * Runs `body` once per available shell, so an assertion that holds under
 * `/bin/sh` and not under `dash` is visible as its own failure rather than as
 * a pass on the machine where `sh` happens to be `bash`.
 */
export function forEachShell(name: string, body: (shell: Shell) => void): void {
  for (const shell of SHELLS) {
    test(`${name} [${shell.label}]`, () => body(shell));
  }
  if (DASH_ABSENT) {
    test.skip(`${name} [dash] — skipped: no dash on this machine, so the POSIX-only path cannot be shown here`, () =>
      undefined);
  }
}
