import { describe, expect, test } from "vitest";
import {
  defaultLogDir,
  waveLogRoot,
  type LogDirConfig,
} from "../../src/internal/logdir.js";

/** `exists` backed by a fixed set of paths — every candidate not listed reads as absent. */
const existsIn =
  (paths: readonly string[]) =>
  (path: string): boolean =>
    paths.includes(path);

const NONE = existsIn([]);

/**
 * Every case below that does not set `WAVE_LOG_ROOT` or `LOGDIR` needs a repo,
 * because A-18 makes the default root per-repo rather than the shared
 * `$HOME/.waves`. `demo` is the name half, so the root is `.waves-demo`; the
 * candidate search itself is unchanged by A-18 and is what these cases cover.
 */
const CFG: LogDirConfig = { repo: "owner/demo" };
const ROOT = "/h/.waves-demo";

describe("defaultLogDir", () => {
  test("no env: root is /tmp/.waves-demo, and with nothing on disk the wave-prefixed default wins", () => {
    expect(defaultLogDir("w06", {}, NONE, CFG)).toBe(
      "/tmp/.waves-demo/wave-w06",
    );
  });

  test("HOME sets the default root", () => {
    expect(defaultLogDir("w06", { HOME: "/Users/op" }, NONE, CFG)).toBe(
      "/Users/op/.waves-demo/wave-w06",
    );
  });

  test("an exported but empty HOME falls back to /tmp, matching ${HOME:-/tmp} (Qodo thread 1)", () => {
    expect(defaultLogDir("w06", { HOME: "" }, NONE, CFG)).toBe(
      "/tmp/.waves-demo/wave-w06",
    );
  });

  test("an exported but empty WAVE_LOG_ROOT falls back to the per-repo root, matching ${VAR:-word}", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h", WAVE_LOG_ROOT: "" }, NONE, CFG),
    ).toBe(`${ROOT}/wave-w06`);
  });

  test("WAVE_LOG_ROOT overrides HOME entirely", () => {
    expect(
      defaultLogDir(
        "w06",
        { HOME: "/Users/op", WAVE_LOG_ROOT: "/srv/waves" },
        NONE,
        CFG,
      ),
    ).toBe("/srv/waves/wave-w06");
  });

  test("a wave id already starting with 'wave' defaults to root/<wave>, not root/wave-<wave>", () => {
    expect(defaultLogDir("wave-hardening-w06", { HOME: "/h" }, NONE, CFG)).toBe(
      `${ROOT}/wave-hardening-w06`,
    );
  });

  test("root/wave-<wave> existing wins outright — the first candidate", () => {
    const exists = existsIn([`${ROOT}/wave-w06`]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      `${ROOT}/wave-w06`,
    );
  });

  test("root/wave<wave> (no dash) wins when the dashed form is absent", () => {
    const exists = existsIn([`${ROOT}/wavew06`]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      `${ROOT}/wavew06`,
    );
  });

  test("root/<wave> only competes when wave itself already starts with 'wave'", () => {
    const exists = existsIn([`${ROOT}/wave-hardening-w06`]);
    expect(
      defaultLogDir("wave-hardening-w06", { HOME: "/h" }, exists, CFG),
    ).toBe(`${ROOT}/wave-hardening-w06`);
  });

  test("a plain wave id never matches the bare root/<wave> candidate, even if it exists", () => {
    // "w06" does not start with "wave", so the bare candidate is never tried —
    // existence there must not be picked up.
    const exists = existsIn([`${ROOT}/w06`]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      `${ROOT}/wave-w06`,
    );
  });

  test("/tmp/wave-<wave> wins once every root candidate is absent", () => {
    const exists = existsIn(["/tmp/wave-w06"]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      "/tmp/wave-w06",
    );
  });

  test("/tmp/wave<wave> wins after /tmp/wave-<wave>", () => {
    const exists = existsIn(["/tmp/wavew06"]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      "/tmp/wavew06",
    );
  });

  test("/tmp/<wave> is the last candidate, and only for a wave id already prefixed", () => {
    const exists = existsIn(["/tmp/wave-hardening-w06"]);
    expect(
      defaultLogDir("wave-hardening-w06", { HOME: "/h" }, exists, CFG),
    ).toBe("/tmp/wave-hardening-w06");
  });

  test("candidate priority: an earlier candidate wins even when a later one also exists", () => {
    const exists = existsIn([`${ROOT}/wave-w06`, "/tmp/wave-w06"]);
    expect(defaultLogDir("w06", { HOME: "/h" }, exists, CFG)).toBe(
      `${ROOT}/wave-w06`,
    );
  });

  test("nothing exists and the wave id does not start with 'wave': default is root/wave-<wave>", () => {
    expect(defaultLogDir("w06", { HOME: "/h" }, NONE, CFG)).toBe(
      `${ROOT}/wave-w06`,
    );
  });

  test("LOGDIR wins outright — the writer reads it before any candidate search", () => {
    expect(
      defaultLogDir("w06", { LOGDIR: "/custom/wave-log" }, NONE, CFG),
    ).toBe("/custom/wave-log");
  });

  test("LOGDIR wins even over WAVE_LOG_ROOT and an existing candidate", () => {
    const exists = existsIn([`${ROOT}/wave-w06`]);
    expect(
      defaultLogDir(
        "w06",
        { LOGDIR: "/custom/wave-log", HOME: "/h", WAVE_LOG_ROOT: "/srv/waves" },
        exists,
        CFG,
      ),
    ).toBe("/custom/wave-log");
  });

  test("LOGDIR set to the empty string is treated as unset — the candidate search still runs", () => {
    // The writer's own `LOGDIR="${LOGDIR:-}"` then `[ -z "$LOGDIR" ]` — POSIX
    // ${VAR:-} substitutes on empty too, so an empty LOGDIR is unset in every
    // way the shell can tell.
    expect(defaultLogDir("w06", { LOGDIR: "", HOME: "/h" }, NONE, CFG)).toBe(
      `${ROOT}/wave-w06`,
    );
  });

  test("LOGDIR never triggers an exists() call — it is not a candidate to verify", () => {
    let called = false;
    const exists = (): boolean => {
      called = true;
      return false;
    };
    defaultLogDir("w06", { LOGDIR: "/custom/wave-log" }, exists, CFG);
    expect(called).toBe(false);
  });
});

describe("the default root is per-repo, never the shared ~/.waves (A-18)", () => {
  test("with LOGDIR, WAVE_LOG_ROOT and waveLogDir all unset, the root is $HOME/.waves-<name>", () => {
    // The brief's named case: wave `orchestration-template-w01` in repo
    // `owner/demo` resolves under `$HOME/.waves-demo/`.
    expect(
      defaultLogDir("orchestration-template-w01", { HOME: "/Users/op" }, NONE, {
        repo: "owner/demo",
      }),
    ).toBe("/Users/op/.waves-demo/wave-orchestration-template-w01");
  });

  test("it never resolves under the shared ~/.waves, whatever exists there", () => {
    // A wave directory left under `~/.waves` by another repo must not be
    // picked up: campaign-foundry's server scans that root and would show
    // false "no PR" flags for this repo's lanes.
    const exists = existsIn([
      "/h/.waves/wave-w06",
      "/h/.waves/wavew06",
      "/h/.waves/w06",
    ]);
    const resolved = defaultLogDir("w06", { HOME: "/h" }, exists, {
      repo: "owner/demo",
    });
    expect(resolved).not.toContain("/h/.waves/");
    expect(resolved).toBe("/h/.waves-demo/wave-w06");
  });

  test("the owner half of repo does not reach the directory name", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h" }, NONE, {
        repo: "octocat/Hello-World",
      }),
    ).toBe("/h/.waves-Hello-World/wave-w06");
  });

  test("config.yaml's waveLogDir wins over the derived per-repo root", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h" }, NONE, {
        repo: "owner/demo",
        waveLogDir: "/srv/waves",
      }),
    ).toBe("/srv/waves/wave-w06");
  });

  test("a waveLogDir of $HOME/.waves-hexagen expands the home directory", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h" }, NONE, {
        waveLogDir: "$HOME/.waves-hexagen",
      }),
    ).toBe("/h/.waves-hexagen/wave-w06");
  });

  test("a waveLogDir of ~/… expands the home directory too", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h" }, NONE, {
        waveLogDir: "~/.waves-hexagen",
      }),
    ).toBe("/h/.waves-hexagen/wave-w06");
  });

  test("an exported but empty waveLogDir falls back to the derived root, matching ${VAR:-word}", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h" }, NONE, {
        repo: "owner/demo",
        waveLogDir: "",
      }),
    ).toBe("/h/.waves-demo/wave-w06");
  });

  test("WAVE_LOG_ROOT still outranks waveLogDir — the operator's override is unchanged", () => {
    expect(
      defaultLogDir("w06", { HOME: "/h", WAVE_LOG_ROOT: "/srv/waves" }, NONE, {
        repo: "owner/demo",
        waveLogDir: "/h/.waves-demo",
      }),
    ).toBe("/srv/waves/wave-w06");
  });

  test("no repo and no waveLogDir is refused, rather than falling back to the shared root", () => {
    // Falling back to `~/.waves` here would be the one thing A-18 forbids, so
    // the resolution fails instead and the caller can be told why.
    expect(() => defaultLogDir("w06", { HOME: "/h" }, NONE)).toThrow(
      /no repository name/,
    );
    expect(() =>
      defaultLogDir("w06", { HOME: "/h" }, NONE, { repo: "owner/" }),
    ).toThrow(/no repository name/);
    expect(() =>
      defaultLogDir("w06", { HOME: "/h" }, NONE, { repo: "" }),
    ).toThrow(/no repository name/);
  });

  test("a repo with no owner half still yields a name, since the suffix is the name half", () => {
    // `repo` is validated as `owner/name` by the config loader; the name half
    // is simply what follows the last slash, and a bare name is still a name.
    // The hazard A-18 guards is the SHARED root, which this never reaches.
    expect(defaultLogDir("w06", { HOME: "/h" }, NONE, { repo: "demo" })).toBe(
      "/h/.waves-demo/wave-w06",
    );
  });
});

describe("F23: waveLogRoot is the root half of defaultLogDir", () => {
  const demo = { repo: "acme/demo" };

  test("WAVE_LOG_ROOT wins over waveLogDir and the default", () => {
    expect(
      waveLogRoot(
        { HOME: "/home/op", WAVE_LOG_ROOT: "/r" },
        { ...demo, waveLogDir: "/w" },
      ),
    ).toBe("/r");
  });

  test.each([
    ["$HOME/.waves-x", "/home/op/.waves-x"],
    ["${HOME}/.waves-x", "/home/op/.waves-x"],
    ["~/.waves-x", "/home/op/.waves-x"],
  ])("waveLogDir %s expands to %s", (waveLogDir, expected) => {
    expect(waveLogRoot({ HOME: "/home/op" }, { ...demo, waveLogDir })).toBe(
      expected,
    );
  });

  test("the default is $HOME/.waves-<name>, never ~/.waves", () => {
    expect(waveLogRoot({ HOME: "/home/op" }, demo)).toBe(
      "/home/op/.waves-demo",
    );
  });

  test("an empty or unset HOME falls back to /tmp", () => {
    expect(waveLogRoot({ HOME: "" }, demo)).toBe("/tmp/.waves-demo");
    expect(waveLogRoot({}, demo)).toBe("/tmp/.waves-demo");
  });

  test("an empty WAVE_LOG_ROOT falls back like an unset one", () => {
    expect(waveLogRoot({ HOME: "/h", WAVE_LOG_ROOT: "" }, demo)).toBe(
      "/h/.waves-demo",
    );
  });

  test("no repo and nothing else to go on throws", () => {
    expect(() => waveLogRoot({ HOME: "/home/op" })).toThrow(
      /no repository name/,
    );
  });

  test("LOGDIR is not a root and is ignored", () => {
    expect(waveLogRoot({ HOME: "/h", LOGDIR: "/one-wave" }, demo)).toBe(
      "/h/.waves-demo",
    );
  });
});
