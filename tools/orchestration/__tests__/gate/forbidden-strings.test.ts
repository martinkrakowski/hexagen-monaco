import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The forbidden strings, checked over every OTHER file this lane owns — the two
 * shell scripts, the bin, the two CLI modules and every test in both
 * directories.
 *
 * Each entry below is a fact about the repository this port came from, not a
 * fact about this one, and each is one that is true in a way a code review of a
 * diff cannot see: a path, a script alias, a log root, a port, or a name that
 * happens to be correct today and would still resolve to that other project
 * tomorrow. A gate is the last thing anyone runs before merging, so a port that
 * quietly kept one of them would break a developer host and not CI.
 *
 * The lane-specific additions are the previous project's environment-variable
 * and script-name prefix. They are here for a different reason: two scripts and
 * two suites with two histories must not both answer to one name, or the lock
 * this lane ships and a lock somebody left behind would fight over the same
 * directory.
 *
 * The one file exempt from the sweep is this one, and it is exempt because a
 * guard has to be able to NAME what it forbids — the patterns, and the reasons,
 * are the forbidden strings written down. Exempting it is a deliberate hole,
 * which is why it is named here rather than left to a reader to work out; every
 * other file in the lane, tests included, is swept.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

/** Every file this lane owns. Listed, not discovered, so a new file is a decision. */
const OWNED: readonly string[] = [
  "bin/gate-lock",
  "bin/gate-run.sh",
  "src/bins/gate.ts",
  "src/gate/cli.ts",
  "src/gate/steps.ts",
  "__tests__/gate/gate.test.ts",
  "__tests__/gate/front-end.test.ts",
  "__tests__/gate/steps.test.ts",
  "__tests__/gate-lock/gate-lock.test.ts",
];

/**
 * The strings that must not appear, each with the rule it enforces.
 *
 * `exceptions` lists the only files allowed to contain the literal, and why —
 * the input of a test that proves a refusal of that very value. There are none:
 * no test here needs to write one of these to prove anything.
 */
interface Forbidden {
  readonly pattern: RegExp;
  readonly why: string;
  readonly exceptions?: readonly {
    readonly file: string;
    readonly why: string;
  }[];
}

const FORBIDDEN: readonly Forbidden[] = [
  {
    // A hardcoded repository is the failure a packaged tool cannot have: it
    // queries the right project on the author's host and the wrong one
    // everywhere else. The repository comes from the overlay.
    // The source project's name is assembled from two halves, never spelled
    // whole, so this guard does not itself put the name into the repository
    // (the same approach the wave-status guard already takes for its wave ids).
    pattern: new RegExp(
      `martinkrakowski|${"campaign"}-${"foundry"}|${"campaign"}${"foundry"}`,
      "i",
    ),
    why: "the repository must come from the overlay, never from a literal",
  },
  {
    // `yarn` aliases are root scripts of the source repository. They resolve
    // only inside that repository, so a published bin that called one would
    // work for exactly one project.
    pattern: /\byarn (plan:review|sweep|gate|wave:status|mutate)/,
    why: "call `npx --no-install hexagen-orchestration-<bin>`, never a root script alias",
  },
  {
    pattern: /~\/\.waves|\$HOME\/\.waves/,
    why: "the log root is derived from the overlay's `waveLogDir`, never a fixed one",
  },
  {
    // Ports are refusals, and refusals come only from the overlay's
    // `forbiddenPorts`; a literal here would refuse a port nobody configured.
    pattern: /\b(3000|3001|4317)\b/,
    why: "ports come only from `waveStatusPort` and `forbiddenPorts`",
  },
  {
    pattern: new RegExp(
      `apps\\/(web|api)\\/|@${"campaign"}${"foundry"}\\/|\\bnitro\\b`,
      "i",
    ),
    why: "these paths belong to the source repository and mean nothing here",
  },
  {
    pattern: /python3/,
    why: "no Python capability is declared; use TypeScript, or `node -e` in a shell script",
  },
  {
    // Lane-specific. The lock directory and the environment variables are
    // prefixed per project, and so are these scripts' own names.
    // Assembled from halves, like the name above: the prefix is the source
    // project's two-letter abbreviation, and it is banned in both spellings.
    pattern: new RegExp(`${"cf"}-gate|${"CF"}_GATE`),
    why: "this project's lock and environment variables are `hexagen-gate*`",
  },
  {
    pattern: /gate-lock\.sh|scripts\/gate\.sh/,
    why: "the script's own name is `bin/gate-lock` and the loop's is `bin/gate-run.sh`",
  },
  {
    // Ids from the source repository's own planning history. A decision number
    // or a lane number means nothing to a reader of this repository, and a
    // comment that carries one is a comment nobody can follow up.
    pattern: /\bD1[0-9]{2}\b|\bHX[0-9][\w-]*|\bw0[0-9]\b|#[0-9]{3}\b/,
    why: "no decision ids, lane ids, wave ids or PR numbers from another repository",
  },
];

/**
 * Every owned file, resolved — and asserted to BE a file, so a path listed here
 * but never created fails loudly instead of being skipped by the sweep below.
 */
function ownedFiles(): readonly string[] {
  return OWNED.map((path) => {
    const full = resolve(PACKAGE_ROOT, path);
    expect(
      statSync(full).isFile(),
      `${path} is listed as owned but is not a file`,
    ).toBe(true);
    return full;
  });
}

/** The files under a directory of owned tests, so a suite added later is covered. */
function filesUnder(directory: string): readonly string[] {
  const root = resolve(PACKAGE_ROOT, directory);
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(root);
  return found;
}

/** This file, named by path rather than by a check, so the exemption is visible. */
const SELF = "__tests__/gate/forbidden-strings.test.ts";

const GUARDED: readonly string[] = [
  ...new Set([
    ...OWNED,
    // Both suites, every file, so a suite added later cannot sit outside the net.
    ...filesUnder("__tests__/gate").map((full) => relative(PACKAGE_ROOT, full)),
    ...filesUnder("__tests__/gate-lock").map((full) =>
      relative(PACKAGE_ROOT, full),
    ),
  ]),
].filter((path) => path !== SELF);

describe("the forbidden strings", () => {
  test("every owned file exists, is swept, and exactly one file is exempt", () => {
    // Resolving through `ownedFiles` is what makes a listed-but-absent path a
    // failure here rather than a hole in the sweep.
    expect(
      ownedFiles()
        .map((full) => relative(PACKAGE_ROOT, full))
        .sort(),
    ).toEqual([...OWNED].sort());
    expect([...GUARDED].sort()).toEqual([...OWNED].sort());
    // The exemption is the guard itself and nothing else: a second exempt file
    // would be a rule that stopped applying without anybody noticing.
    const swept = [...OWNED, SELF];
    expect(swept.length).toBe(GUARDED.length + 1);
  });

  test.each(FORBIDDEN.map((rule) => [rule.pattern.source, rule] as const))(
    "no owned file carries %s",
    (_source, rule) => {
      const offenders: string[] = [];
      for (const path of GUARDED) {
        const text = readFileSync(resolve(PACKAGE_ROOT, path), "utf8");
        if (!rule.pattern.test(text)) continue;
        const allowed = (rule.exceptions ?? []).some(
          (exception) => exception.file === path,
        );
        if (!allowed) offenders.push(path);
      }
      expect(offenders, `${rule.why}`).toEqual([]);
    },
  );

  test("every allowed exception is declared with a reason, and none is a live one", () => {
    // An exception list that grows is a forbidden list that stopped being one,
    // so each entry has to say what it is for rather than just which file holds
    // it. An entry naming a file that does not exist is a rule that silently
    // stopped applying.
    const declared = FORBIDDEN.flatMap((rule) => rule.exceptions ?? []);
    for (const exception of declared) {
      expect(exception.why.trim(), `${exception.file}`).not.toBe("");
      expect(
        statSync(resolve(PACKAGE_ROOT, exception.file)).isFile(),
        `${exception.file} is an allowed exception but does not exist`,
      ).toBe(true);
    }
    expect(declared).toEqual([]);
  });
});

describe("the guard itself", () => {
  test("each rule fires on a planted string, and stays quiet on a real owned file", () => {
    // A guard that cannot fail is not a guard. This plants a string every rule
    // is written to catch and proves the rule fires on it — without writing to
    // the package — and proves the same rule is quiet on a file that has been
    // swept all along.
    const plants: Readonly<Record<string, string>> = {
      [FORBIDDEN[0].pattern.source]: `${"campaign"}-${"foundry"}`,
      [FORBIDDEN[1].pattern.source]: "yarn plan:review",
      [FORBIDDEN[2].pattern.source]: "~/.waves",
      [FORBIDDEN[3].pattern.source]: "listen on port 4317",
      [FORBIDDEN[4].pattern.source]: "scans apps/api/server/",
      [FORBIDDEN[5].pattern.source]: "python3 -m tools",
      [FORBIDDEN[6].pattern.source]: `${"CF"}_GATE_STEPS`,
      [FORBIDDEN[7].pattern.source]: "sh scripts/gate-lock.sh",
      [FORBIDDEN[8].pattern.source]: "plan D199 says",
    };
    expect(Object.keys(plants).length).toBe(FORBIDDEN.length);
    for (const rule of FORBIDDEN) {
      const planted = plants[rule.pattern.source];
      expect(
        rule.pattern.test(planted),
        `${rule.pattern.source} misses its own plant`,
      ).toBe(true);
      expect(
        rule.pattern.test(
          readFileSync(resolve(PACKAGE_ROOT, OWNED[0]), "utf8"),
        ),
      ).toBe(false);
    }
  });
});
