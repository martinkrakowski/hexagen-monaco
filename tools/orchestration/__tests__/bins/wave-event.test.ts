import { describe, expect, test } from "vitest";
import {
  runWaveEvent,
  parseDetail,
  type WaveEventDeps,
} from "../../src/internal/wave-event-cli.js";
import { readEvents } from "../../src/internal/events.js";

/**
 * `hexagen-orchestration-wave-event` (N-7 — the TypeScript port of
 * `scripts/wave-event.sh`).
 *
 * Two properties carry the whole bin:
 *
 * - **Nothing written on a refusal.** The source validated first and appended
 *   last, so a rejected event never reaches the log even as garbage a reader
 *   would have to reject later. Every refusal case here asserts the log is
 *   untouched AND that no directory was created.
 * - **Both calling forms survive.** The skill shim forwards `"$@"`, so every
 *   current caller must keep working untouched.
 */

const CLOCK = (): string => "2026-09-07T16:55:43Z";

interface Recorded {
  readonly code: number;
  readonly stderr: string;
  /** Every path appended to, in order. */
  readonly appended: { path: string; data: string }[];
  /** Every directory created, in order. */
  readonly created: string[];
}

/** Run argv and return the code, the stderr text, and what was written. */
async function run(
  argv: string[],
  options: {
    env?: WaveEventDeps["env"];
    exists?: (path: string) => boolean;
    config?: WaveEventDeps["config"];
  } = {},
): Promise<Recorded> {
  const appended: { path: string; data: string }[] = [];
  const created: string[] = [];
  const lines: string[] = [];
  const deps: WaveEventDeps = {
    env: options.env ?? { HOME: "/home/op" },
    ...(options.config !== undefined ? { config: options.config } : {}),
    exists: options.exists ?? ((): boolean => false),
    mkdir: async (path) => void created.push(path),
    appendFile: async (path, data) => void appended.push({ path, data }),
    clock: CLOCK,
    stderr: (line) => void lines.push(line),
  };
  const code = await runWaveEvent(argv, deps);
  return { code, stderr: lines.join("\n"), appended, created };
}

const positional = (logdir: string, ...rest: string[]): string[] => [
  logdir,
  ...rest,
];

describe("both calling forms append one line", () => {
  test("a leading positional log directory", async () => {
    const result = await run(
      positional("/logs/w1", "W3", "l1", "dispatch", "started"),
    );
    expect(result.code).toBe(0);
    expect(result.appended).toHaveLength(1);
    expect(result.appended[0].path).toBe("/logs/w1/events.jsonl");
    expect(readEvents(result.appended[0].data).events).toEqual([
      {
        ts: "2026-09-07T16:55:43Z",
        wave: "W3",
        lane: "l1",
        stage: "dispatch",
        event: "started",
      },
    ]);
  });

  test("--logdir BEFORE the four positionals", async () => {
    const result = await run([
      "--logdir",
      "/logs/w1",
      "W3",
      "l1",
      "dispatch",
      "started",
    ]);
    expect(result.code).toBe(0);
    expect(result.appended[0].path).toBe("/logs/w1/events.jsonl");
  });

  test("a --logdir after the event is an unknown option, as in the source", async () => {
    // The positionals are consumed first, so a flag in that position never
    // reaches the leading-flag branch. Refusing is the source's behaviour and
    // the skill shim relies on it to catch a misplaced flag.
    const result = await run([
      "W3",
      "l1",
      "dispatch",
      "started",
      "--logdir",
      "/logs/w1",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option: --logdir");
    expect(result.appended).toEqual([]);
  });

  test("--pr, --round and --detail ride along", async () => {
    const result = await run(
      positional(
        "/logs/w1",
        "W3",
        "l1",
        "review",
        "settled",
        "--pr",
        "42",
        "--round",
        "2",
        "--detail",
        '{"verdict":"clear"}',
      ),
    );
    expect(result.code).toBe(0);
    expect(readEvents(result.appended[0].data).events[0]).toEqual({
      ts: "2026-09-07T16:55:43Z",
      wave: "W3",
      lane: "l1",
      stage: "review",
      event: "settled",
      pr: 42,
      round: 2,
      detail: { verdict: "clear" },
    });
  });
});

describe("a refusal exits 2, writes nothing, and creates no directory", () => {
  const refusal = async (argv: string[], expected: RegExp) => {
    const result = await run(argv);
    expect(result.code, `${argv.join(" ")} → ${result.stderr}`).toBe(2);
    expect(result.stderr).toMatch(expected);
    expect(result.appended, "nothing appended").toEqual([]);
    expect(result.created, "no directory created").toEqual([]);
  };

  test("an unknown stage", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "deploy", "started"),
      /unknown stage: deploy/,
    ));

  test("an unknown event", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "dispatch", "skipped"),
      /unknown event: skipped/,
    ));

  test("a stage outside the vocabulary, in the two-argument form", () =>
    refusal(["W3", "l1", "deploy", "started"], /unknown stage: deploy/));

  test("a wave that is not a token", () =>
    refusal(
      positional("/logs/w1", 'l"1', "l1", "dispatch", "started"),
      /invalid wave/,
    ));

  test("a lane that is not a token", () =>
    refusal(
      positional("/logs/w1", "W3", 'l"1', "dispatch", "started"),
      /invalid lane/,
    ));

  // A trailing dollar anchor without the m flag does not match before a trailing
  // newline, so the token pattern already refuses these. Locked here so a
  // well-meant tweak to the pattern (an m flag, a whitespace tail) cannot
  // quietly reopen it.
  test("a wave with a trailing newline", () =>
    refusal(
      positional("/logs/w1", "w1\n", "l1", "dispatch", "started"),
      /invalid wave/,
    ));

  test("a lane with a trailing newline", () =>
    refusal(
      positional("/logs/w1", "W3", "l1\n", "dispatch", "started"),
      /invalid lane/,
    ));

  test("a wave with a slash in it", () =>
    refusal(
      positional("/logs/w1", "w/3", "l1", "dispatch", "started"),
      /invalid wave/,
    ));

  test("a --pr that is not an integer", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--pr", "1x"),
      /--pr must be a number: 1x/,
    ));

  test("a --round that is not an integer", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--round", "two"),
      /--round must be a number: two/,
    ));

  test("a --pr with no value", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--pr"),
      /missing value for --pr/,
    ));

  test("an unknown option", () =>
    refusal(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--nope", "1"),
      /unknown option: --nope/,
    ));

  test("too few arguments", () => refusal(["W3", "l1"], /usage: wave-event/));
});

describe("--detail must be a JSON object, checked without python3", () => {
  const refusal = async (detail: string) => {
    const result = await run(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--detail", detail),
    );
    expect(result.code, detail).toBe(2);
    expect(result.stderr).toContain("--detail must be a JSON object");
    expect(result.appended).toEqual([]);
    expect(result.created).toEqual([]);
  };

  test("an array is refused, as python3's isinstance(d, dict) refused it", () =>
    refusal("[]"));
  test("a JSON array of objects is refused too", () => refusal('[{"bug":1}]'));
  test("a bare string is refused", () => refusal('"hello"'));
  test("a number is refused", () => refusal("42"));
  test("null is refused", () => refusal("null"));
  test("malformed JSON is refused", () => refusal("{bad"));
  test("a trailing comma is refused", () => refusal('{"a":1,}'));

  test("an empty detail is treated as unset, exactly as the source's -n test did", async () => {
    const result = await run(
      positional("/logs/w1", "W3", "l1", "gate", "settled", "--detail", ""),
    );
    expect(result.code).toBe(0);
    expect(readEvents(result.appended[0].data).events[0]).not.toHaveProperty(
      "detail",
    );
  });

  test("an object is accepted, however it is spaced", async () => {
    const result = await run(
      positional(
        "/logs/w1",
        "W3",
        "l1",
        "gate",
        "settled",
        "--detail",
        '{ "bug": 1 }',
      ),
    );
    expect(result.code).toBe(0);
    expect(readEvents(result.appended[0].data).events[0]!.detail).toEqual({
      bug: 1,
    });
  });

  test("parseDetail is the same rule on its own", () => {
    expect(parseDetail('{"a":1}')).toEqual({ a: 1 });
    expect(parseDetail("")).toBeUndefined();
    for (const bad of ["[]", '"x"', "1", "null", "{"]) {
      expect(() => parseDetail(bad), bad).toThrow(/must be a JSON object/);
    }
  });
});

describe("the default log root", () => {
  test("with $LOGDIR set and no flag or positional, the event goes there", async () => {
    const result = await run(["W3", "l1", "dispatch", "started"], {
      env: { LOGDIR: "/custom", HOME: "/home/op" },
    });
    expect(result.code).toBe(0);
    expect(result.appended[0].path).toBe("/custom/events.jsonl");
  });

  test("without it, the per-repo root is used and never the shared ~/.waves (A-18)", async () => {
    const result = await run(["W3", "l1", "dispatch", "started"], {
      env: { HOME: "/home/op" },
      config: { repo: "owner/demo" },
    });
    expect(result.code).toBe(0);
    expect(result.appended[0].path).toBe(
      "/home/op/.waves-demo/wave-W3/events.jsonl",
    );
    expect(result.appended[0].path).not.toContain("/.waves/");
  });

  test("an existing candidate directory is preferred, as the source preferred it", async () => {
    const result = await run(["W3", "l1", "dispatch", "started"], {
      env: { HOME: "/home/op" },
      config: { repo: "owner/demo" },
      exists: (path) => path === "/home/op/.waves-demo/waveW3",
    });
    expect(result.appended[0].path).toBe(
      "/home/op/.waves-demo/waveW3/events.jsonl",
    );
  });

  test("a refusal with no log directory never creates one", async () => {
    const result = await run(["W3", "l1", "deploy", "started"], {
      env: { HOME: "/home/op" },
      config: { repo: "owner/demo" },
    });
    expect(result.code).toBe(2);
    expect(result.created).toEqual([]);
  });

  test("no log directory and no repo is refused, never the shared root (A-18)", async () => {
    // The source would have used ~/.waves here. Refusing is the point: the
    // shared root is what makes one repo server misreport another.
    const result = await run(["W3", "l1", "dispatch", "started"], {
      env: { HOME: "/home/op" },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("no repository name");
    expect(result.appended).toEqual([]);
    expect(result.created).toEqual([]);
  });
});

describe("F20: every event is stamped with the repository", () => {
  test("an event for repo acme/demo carries repo right after wave", async () => {
    const result = await run(
      positional("/logs/w1", "W3", "l1", "dispatch", "started"),
      { config: { repo: "acme/demo" } },
    );
    expect(result.code).toBe(0);
    const line = result.appended[0]!.data;
    expect(JSON.parse(line).repo).toBe("acme/demo");
    expect(line).toContain('"wave":"W3","repo":"acme/demo","lane":"l1"');
    expect(readEvents(line).events[0]?.repo).toBe("acme/demo");
  });

  test("with no repo resolved the key is omitted, never null", async () => {
    const result = await run(
      positional("/logs/w1", "W3", "l1", "dispatch", "started"),
    );
    expect(result.appended[0]!.data).not.toContain("repo");
  });
});
