import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * What must not ship from here.
 *
 * This package is PUBLIC, and a port carries its source's history in its
 * comments, its fixtures and its test names. Three classes of string are
 * therefore refused outright, and each is a fact about the source project
 * rather than a fact about this one:
 *
 *   - **A hardcoded repository.** A packaged tool that names one repository
 *     queries the wrong one everywhere else.
 *   - **A `yarn` script alias.** A root script that exists only in the source
 *     project resolves nowhere else, so every caller is told to use
 *     `npx --no-install hexagen-orchestration-<bin>` instead.
 *   - **A project path, an internal package scope, a fixed port, a fixed log
 *     root, and `python3`** — none of which is this project's business.
 *
 * The grep covers EVERY file this lane owns, tests included, because the file
 * that leaks is almost always a comment in a test: that is where a ported
 * fixture's own path and its author's history sit.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

/** Everything this lane owns. Nothing outside it is scanned, and nothing in it is skipped. */
const OWNED = [
  "src/bins/mutate.ts",
  "src/bins/mutate-verify.ts",
  "src/bins/mutate-anchors.ts",
  "bin/verify-manifests",
  "src/mutate",
  "src/mutate-manifest",
  "__tests__/mutate",
  "__tests__/mutate-manifest",
  "__tests__/verify-manifests",
] as const;

interface Rule {
  readonly needle: string;
  readonly why: string;
  /**
   * Files allowed to contain the needle anyway, with the reason. An exception
   * is only ever a test that PROVES a refusal of that very value, or this file:
   * a test cannot search for a string it is forbidden to write down.
   */
  readonly allowed: Readonly<Record<string, string>>;
}

/**
 * This file, and the only blanket exception. It has to spell every needle out
 * to look for it, so it necessarily contains all of them; it holds no ported
 * history, and a reader can audit it in one sitting. Every OTHER exception has
 * to name the test that proves the refusal of its own value.
 */
const SELF = "__tests__/verify-manifests/forbidden.test.ts";
const SELF_REASON =
  "this test names the needle in order to search for it, and holds no ported history";

/**
 * `yarn mutate:` is a PREFIX rather than the two exact aliases, so
 * `yarn mutate:verify` and every other spelling below it are caught too.
 */
const RULES: readonly Rule[] = [
  {
    needle: "martinkrakowski",
    why: "a hardcoded owner/repository name (A-4, A-8)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    // Assembled from two halves so this list does not itself name the project.
    needle: `${"campaign"}-${"foundry"}`,
    why: "the source repository's own name (A-4, A-8)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "yarn mutate:",
    why: "a source-project `yarn` script alias (A-9) — the prefix catches every spelling",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "yarn plan:review",
    why: "a source-project `yarn` script alias (A-9)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "yarn sweep",
    why: "a source-project `yarn` script alias (A-9)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "yarn gate",
    why: "a source-project `yarn` script alias (A-9)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "yarn wave:status",
    why: "a source-project `yarn` script alias (A-9)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "~/.waves",
    why: "a fixed log root (A-18)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "$HOME/.waves",
    why: "a fixed log root (A-18)",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "apps/web/",
    why: "the source project's own application path",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "apps/api/",
    why: "the source project's own application path",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: `@${"campaign"}${"foundry"}/`,
    why: "the source project's own package scope",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "nitro",
    why: "the source project's own framework",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "python3",
    why: "OW-D7 dropped python3 as a capability",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "ffmpeg",
    why: "a source-project dependency named in a lesson",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "Compositor",
    why: "a source-project class name named in a lesson",
    allowed: { [SELF]: SELF_REASON },
  },
  {
    needle: "skip-build",
    why: "a source-project install flag named in a lesson",
    allowed: { [SELF]: SELF_REASON },
  },
];

/** Ports, which are never literals here: they come from the overlay or nowhere. */
const PORTS = ["3000", "3001", "4317"] as const;

function filesUnder(absolute: string): string[] {
  const stats = statSync(absolute);
  if (stats.isFile()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    filesUnder(join(absolute, entry.name)),
  );
}

const FILES: readonly string[] = OWNED.flatMap((owned) =>
  filesUnder(join(PACKAGE_ROOT, owned)),
);

const read = (path: string): string => readFileSync(path, "utf8");

describe("the grep is over the whole lane", () => {
  it("found every owned file, so an empty scan cannot pass as a clean scan", () => {
    // A path that does not exist throws, and a typo'd glob would quietly scan
    // one directory instead of three. This is the check that the check runs.
    expect(FILES.length).toBeGreaterThan(20);
    expect(
      FILES.some((f) => f.includes(`${join("src", "mutate", "cli.ts")}`)),
    ).toBe(true);
    expect(
      FILES.some((f) =>
        f.includes(join("src", "mutate-manifest", "lib", "anchors.ts")),
      ),
    ).toBe(true);
    expect(FILES.some((f) => f.endsWith(join("bin", "verify-manifests")))).toBe(
      true,
    );
    expect(
      FILES.some((f) =>
        f.includes(join("__tests__", "mutate", "survived.test.ts")),
      ),
    ).toBe(true);
  });

  it.each(RULES.map((rule) => [rule.needle, rule.why] as const))(
    "no file carries %s — %s",
    (needle, why) => {
      const rule = RULES.find((r) => r.needle === needle);
      if (rule === undefined) throw new Error(`no rule for ${needle}`);
      const hits = FILES.filter((file) => {
        if (rule.allowed[relative(PACKAGE_ROOT, file)] !== undefined)
          return false;
        return read(file).includes(needle);
      }).map((file) => relative(PACKAGE_ROOT, file));
      expect(hits, `${needle} — ${why}`).toEqual([]);
    },
  );

  it.each(PORTS)("no file carries the literal port %s", (port) => {
    // A port is a decision about someone else's machine. It comes from the
    // overlay, or the run has no port to bind. This file names the ports it
    // searches for, so it is exempt here too, for the same reason.
    const hits = FILES.filter((file) => {
      if (relative(PACKAGE_ROOT, file) === SELF) return false;
      return new RegExp(`(^|[^0-9])${port}([^0-9]|$)`).test(read(file));
    }).map((file) => relative(PACKAGE_ROOT, file));
    expect(hits, `literal port ${port}`).toEqual([]);
  });
});

describe("the exceptions this file allows, read back", () => {
  it("are only this file, so a permitted leak has to be argued in this file", () => {
    const others = RULES.flatMap((rule) =>
      Object.entries(rule.allowed)
        .filter(([file]) => file !== SELF)
        .map(([file, reason]) => [rule.needle, file, reason] as const),
    );
    expect(
      others,
      "every exception other than this file must name the test that proves the refusal",
    ).toEqual([]);
    // And the blanket one says why it is blanket, so deleting this line breaks
    // the test rather than silently widening it.
    expect(SELF_REASON.length).toBeGreaterThan(0);
  });
});
