/**
 * Reading a manifest `command` well enough to ask whether it still selects a
 * test — and, when syntax cannot answer, turning it into the listing that can.
 *
 * The `-t` argument is the whole problem. `vitest -t` is a regex matched
 * against a test's full name, and a pattern that matches nothing runs nothing,
 * skips everything and exits 0. The replay reads that exit code as the
 * verdict, so a `-t` that has stopped matching — a renamed test, or a title
 * whose parentheses were pasted into the pattern where they are a capture group
 * rather than two literal characters — is indistinguishable from a mutation
 * that genuinely survived. It has produced a false "survived" twice, which is
 * worse than a refusal: it is a confident wrong verdict.
 */

/**
 * Flags whose value is the NEXT argv entry. Consuming them matters in both
 * directions: `--project web` must not leave `web` behind as a file, and
 * `--json` swallows the argument after it as an output path — a real hazard,
 * since `vitest list --json some.test.ts` does not list that file, it
 * OVERWRITES it.
 *
 * An unlisted flag's value can be mistaken for a positional, so the positional
 * test below is narrow. A misread here can only ever cost a static proof, never
 * manufacture one: the caller escalates anything it cannot prove.
 */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-t",
  "--testNamePattern",
  "-c",
  "--config",
  "--project",
  "--reporter",
  "--outputFile",
  "--json",
  "--maxWorkers",
  "--minWorkers",
  "--pool",
  "--shard",
  "--dir",
  "--exclude",
  "--environment",
  "--retry",
  "--testTimeout",
  "--hookTimeout",
]);

/** The words a runner is invoked through, before the first real argument. */
const RUNNER_WORDS: ReadonlySet<string> = new Set([
  "yarn",
  "npm",
  "pnpm",
  "npx",
  "exec",
  "vitest",
]);

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

export interface ParsedCommand {
  /** Positionals that name a test file on disk. Anything else is not claimed. */
  readonly files: readonly string[];
  /** The `-t` regex source, verbatim. Absent when the command selects by file only. */
  readonly pattern?: string;
}

export function parseVitestCommand(argv: readonly string[]): ParsedCommand {
  const files: string[] = [];
  let pattern: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-t" || arg === "--testNamePattern") {
      pattern = argv[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      // `--maxWorkers=2` carries its own value; `--project web` takes the next.
      if (!arg.includes("=") && VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    if (RUNNER_WORDS.has(arg)) continue;
    if (TEST_FILE.test(arg)) files.push(arg);
  }
  return pattern === undefined ? { files } : { files, pattern };
}

/**
 * True when a static match against a name built from syntax is proof.
 *
 * A name built by `testNames` is always a SUFFIX of the real full name — a
 * suite wrapper this checker could not read only adds leading text — so an
 * unanchored regex that matches the built name matches the real one too. `^`
 * and `$` break that implication, so an anchored pattern is never proved here
 * and goes to vitest instead. (No pattern in this repo's manifests is
 * anchored, so this costs nothing today; it is here so that the first one
 * cannot quietly be believed.)
 */
export function provable(pattern: string): boolean {
  return !/[$^]/.test(pattern);
}

/**
 * The same command, collecting instead of running: `vitest run …` becomes
 * `vitest list …`, everything else untouched.
 *
 * Deliberately a rewrite of the recorded argv rather than an invocation rebuilt
 * from the parse above. `--project`, the file filters and `-t` then reach vitest
 * exactly as the replay will pass them, and the answer comes from vitest's own
 * collector and its own `new RegExp(pattern)` — nothing here re-implements the
 * matching, so nothing here drifts when vitest is upgraded.
 */
export function listingCommand(
  argv: readonly string[],
): readonly string[] | undefined {
  const vitest = argv.indexOf("vitest");
  if (vitest === -1 || argv[vitest + 1] !== "run") return undefined;
  return argv.map((arg, index) => (index === vitest + 1 ? "list" : arg));
}

/**
 * The same listing with the `-t` selector removed, so it answers "what does
 * this file register here?" rather than "what does this pattern select?".
 *
 * Only ever run when the `-t` listing came back empty, and only to tell two
 * different things apart. An empty selection means either the pattern matches
 * nothing — a real finding, the mutation reports "survived" without running —
 * or the file registers no tests in THIS environment, in which case the check
 * could not look and must not answer. They are indistinguishable from the
 * selecting listing alone, and the second one is not a finding about the
 * manifest at all.
 *
 * Measured: an install made with the postinstall step skipped never runs a
 * binary-fetching dependency's postinstall, so the tests gated on that fetched
 * binary do not register, and one manifest entry was reported as a dead pattern.
 * Its pattern was fine. A full install cleared it — which is the point: the tree
 * was never wrong, the environment was, and a checker that cannot tell those
 * apart sends a lane hunting through manifests for a defect that is not in them.
 */
export function unselectedListing(
  listing: readonly string[],
): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < listing.length; i++) {
    const arg = listing[i] as string;
    if (arg === "-t" || arg === "--testNamePattern") {
      i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}
