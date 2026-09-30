import { countOccurrences } from "../../mutate/lib/mutate.js";
import {
  listingCommand,
  parseVitestCommand,
  provable,
  unselectedListing,
} from "./commands.js";
import { ManifestError, parseManifest } from "./manifest.js";
import { testNames } from "./test-names.js";
import type { ManifestMutation } from "./types.js";

export const EXIT_LIVE = 0;
export const EXIT_DEAD = 1;

/**
 * A mutation's `before` text is an ADDRESS, and addresses rot.
 *
 * `runMutation` refuses before-text that does not appear exactly once (Rule 2),
 * and `bin/verify-manifests` replays only the manifests a diff touches. Put
 * those together and a lane that reformats one source file silently kills
 * anchors in manifests nobody will look at — not merely unchecked, but
 * *unrunnable*, because the refusal is permanent and a manifest replays whole.
 * The claim stops being enforced and nothing anywhere says so.
 *
 * The replay is expensive: it applies a mutation and runs a real suite. This is
 * the cheap half — for EVERY manifest, does each live `before` still appear
 * exactly once in its `file`? It is a string count. No build, no tests, no
 * spawn. That is what makes it affordable to run over all of them every time,
 * which is the only way a stale anchor in an untouched manifest is ever seen.
 *
 * ## The second address: the `-t` pattern
 *
 * `before` is not the only thing in a manifest that rots silently. A mutation's
 * `command` is almost always `vitest run <file> -t <pattern>`, and `-t` is a
 * REGEX matched against a test's full name. A pattern that matches nothing does
 * not fail: vitest skips every test and exits 0, and the replay reads that
 * exit code as `survived`. A renamed test and a surviving mutant are spelled
 * the same way — and this one is worse than a dead anchor, because a dead
 * anchor REFUSES while this one answers, confidently and wrongly. It has done
 * so twice: once when a test title's parenthesised reference was pasted into
 * the pattern whole, where the parentheses are a capture group and not two
 * literal characters — the whole file's tests were skipped, the command exited
 * 0, and the mutation read as "survived" — and once across three entries after
 * the test they named was renamed.
 *
 * So the same one-count question is asked of the pattern: does it select at
 * least one test? The answer is taken from syntax where syntax can give it
 * (`test-names.ts`), which costs a parse and no spawn; where it cannot — a
 * `test.each` title formatted per case, a title that is an expression — the
 * entry is escalated to `vitest list`, which is vitest's own collector and its
 * own matching. Only a listing that finds nothing is a fault. Syntax is used to
 * PROVE liveness cheaply, never to condemn.
 */
export type AnchorFault =
  | {
      readonly kind: "unreadable";
      readonly manifest: string;
      readonly detail: string;
    }
  | {
      readonly kind: "malformed";
      readonly manifest: string;
      readonly detail: string;
    }
  | {
      readonly kind: "missing-file";
      readonly manifest: string;
      readonly index: number;
      readonly mutation: ManifestMutation;
      readonly detail: string;
    }
  | {
      readonly kind: "not-exactly-once";
      readonly manifest: string;
      readonly index: number;
      readonly mutation: ManifestMutation;
      readonly occurrences: number;
    }
  | {
      readonly kind: "bad-pattern";
      readonly manifest: string;
      readonly index: number;
      readonly mutation: ManifestMutation;
      readonly pattern: string;
      readonly detail: string;
    }
  | {
      readonly kind: "unlistable";
      readonly manifest: string;
      readonly index: number;
      readonly mutation: ManifestMutation;
      readonly pattern: string;
      readonly detail: string;
    }
  | {
      readonly kind: "dead-pattern";
      readonly manifest: string;
      readonly index: number;
      readonly mutation: ManifestMutation;
      readonly pattern: string;
    };

export interface AnchorReport {
  readonly manifests: number;
  readonly mutations: number;
  readonly retired: number;
  /** Live mutations whose command carries a `-t` pattern — the ones at risk. */
  readonly patterns: number;
  /** Patterns shown live by syntax alone: no spawn, no build, no test run. */
  readonly proved: number;
  /** Patterns syntax could not prove, so vitest's own collector was asked. */
  readonly confirmed: number;
  /** Wall time spent inside those listings, so their cost stays visible. */
  readonly confirmMs: number;
  readonly faults: readonly AnchorFault[];
}

export interface AnchorDeps {
  /** Reads a manifest or a source file. Rejects if it is not there. */
  readonly readText: (path: string) => Promise<string>;
  /**
   * Runs `vitest list` and returns the test names it printed, one per line.
   * Rejects if the listing could not be run at all — which is a fault of its
   * own, never a pass: a check that cannot look must not report "nothing".
   */
  readonly listTests: (
    command: readonly string[],
  ) => Promise<readonly string[]>;
  /** Monotonic milliseconds, injected so the reported cost is testable. */
  readonly now: () => number;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Checks every anchor, and every `-t` pattern, in every manifest it is given.
 *
 * Source files are read once and cached: many manifests anchor into
 * `NotePanel.tsx`, and re-reading it once per manifest is the difference
 * between a check that runs on every push and one somebody switches off. Test
 * files are parsed once for the same reason — `note-panel.test.tsx` carries
 * dozens of patterns and is among the largest files in the repo.
 *
 * A manifest that cannot be read or parsed is a FAULT, never a skip. An
 * unexplained retirement (`"retired": true`, or an empty reason) is refused by
 * `parseManifest`, so it arrives here as `malformed` and fails the check — if
 * this swallowed parse errors, the one guard keeping retirement honest would be
 * unreachable from the gate that is supposed to enforce it.
 */
export async function checkAnchors(
  manifestPaths: readonly string[],
  deps: AnchorDeps,
): Promise<AnchorReport> {
  const faults: AnchorFault[] = [];
  const sources = new Map<string, string | Error>();
  const names = new Map<string, readonly string[]>();
  let mutations = 0;
  let retired = 0;
  let patterns = 0;
  let proved = 0;
  let confirmed = 0;
  let confirmMs = 0;

  const read = async (path: string): Promise<string | Error> => {
    let source = sources.get(path);
    if (source === undefined) {
      source = await deps
        .readText(path)
        .catch((error: unknown) =>
          error instanceof Error ? error : new Error(message(error)),
        );
      sources.set(path, source);
    }
    return source;
  };

  /** The names a test file registers that can be read off its syntax alone. */
  const namesIn = async (file: string): Promise<readonly string[]> => {
    let known = names.get(file);
    if (known === undefined) {
      const source = await read(file);
      known = source instanceof Error ? [] : testNames(source, file);
      names.set(file, known);
    }
    return known;
  };

  for (const manifest of manifestPaths) {
    let text: string;
    try {
      text = await deps.readText(manifest);
    } catch (error) {
      faults.push({ kind: "unreadable", manifest, detail: message(error) });
      continue;
    }
    let parsed;
    try {
      parsed = parseManifest(text);
    } catch (error) {
      /* istanbul ignore next -- parseManifest throws only ManifestError. The guard is here so an
         unexpected failure surfaces as itself rather than as a bad manifest. */
      if (!(error instanceof ManifestError)) throw error;
      faults.push({ kind: "malformed", manifest, detail: error.message });
      continue;
    }

    for (const [index, mutation] of parsed.mutations.entries()) {
      mutations++;
      if (mutation.retired !== undefined) {
        // Retired: the subject is gone by admission, so there is nothing to
        // find and its absence is not news.
        retired++;
        continue;
      }
      const source = await read(mutation.file);
      if (source instanceof Error) {
        faults.push({
          kind: "missing-file",
          manifest,
          index,
          mutation,
          detail: source.message,
        });
      } else {
        const occurrences = countOccurrences(source, mutation.before);
        if (occurrences !== 1) {
          faults.push({
            kind: "not-exactly-once",
            manifest,
            index,
            mutation,
            occurrences,
          });
        }
      }

      const { files, pattern } = parseVitestCommand(mutation.command);
      if (pattern === undefined) continue;
      patterns++;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        faults.push({
          kind: "bad-pattern",
          manifest,
          index,
          mutation,
          pattern,
          detail: message(error),
        });
        continue;
      }
      let matched = false;
      if (provable(pattern)) {
        for (const file of files) {
          if ((await namesIn(file)).some((name) => regex.test(name))) {
            matched = true;
            break;
          }
        }
      }
      if (matched) {
        proved++;
        continue;
      }
      // Syntax could not show this pattern live. That is not yet a finding —
      // `test.each` builds its titles from case data and a title can be an
      // expression — so vitest is asked, with the command the replay will use.
      const listing = listingCommand(mutation.command);
      if (listing === undefined) {
        faults.push({
          kind: "unlistable",
          manifest,
          index,
          mutation,
          pattern,
          detail:
            "not a `vitest run …` command, so its selection cannot be collected",
        });
        continue;
      }
      const started = deps.now();
      let listed: readonly string[];
      try {
        listed = await deps.listTests(listing);
      } catch (error) {
        confirmMs += deps.now() - started;
        faults.push({
          kind: "unlistable",
          manifest,
          index,
          mutation,
          pattern,
          detail: message(error),
        });
        continue;
      }
      confirmMs += deps.now() - started;
      confirmed++;
      if (listed.length !== 0) continue;
      // Empty. That is two different things wearing the same face: the pattern
      // selects nothing (a finding — the replay would report "survived" without
      // running a test), or this file registers nothing HERE (not a finding —
      // the check could not look). Ask once more without the selector; the cost
      // is paid only on this path, so a clean run still lists once per pattern.
      const registeredStarted = deps.now();
      let registered: readonly string[];
      try {
        registered = await deps.listTests(unselectedListing(listing));
      } catch (error) {
        confirmMs += deps.now() - registeredStarted;
        faults.push({
          kind: "unlistable",
          manifest,
          index,
          mutation,
          pattern,
          detail: message(error),
        });
        continue;
      }
      confirmMs += deps.now() - registeredStarted;
      faults.push(
        registered.length === 0
          ? {
              kind: "unlistable",
              manifest,
              index,
              mutation,
              pattern,
              detail:
                "the file registers no tests in this environment, so the listing cannot say " +
                "whether the pattern selects one — check the install before the manifest " +
                "(an install that skips its postinstall step never registers tests gated on " +
                "what that step fetches)",
            }
          : { kind: "dead-pattern", manifest, index, mutation, pattern },
      );
    }
  }

  return {
    manifests: manifestPaths.length,
    mutations,
    retired,
    patterns,
    proved,
    confirmed,
    confirmMs,
    faults,
  };
}

const FAULT_HEADLINE: Record<AnchorFault["kind"], string> = {
  unreadable: "UNREADABLE MANIFEST",
  malformed: "MALFORMED MANIFEST",
  "missing-file": "FILE GONE",
  "not-exactly-once": "DEAD ANCHOR",
  "bad-pattern": "UNUSABLE -t PATTERN",
  unlistable: "UNCHECKABLE COMMAND",
  "dead-pattern": "DEAD -t PATTERN",
};

/** The faults that name one mutation. `unreadable`/`malformed` name a whole manifest. */
type MutationFault = Extract<AnchorFault, { readonly index: number }>;

function faultDetail(fault: MutationFault): string {
  switch (fault.kind) {
    case "missing-file":
      return `  ${fault.detail}`;
    case "not-exactly-once":
      return (
        `  before-text appears ${fault.occurrences} time(s); Rule 2 needs exactly 1, so this` +
        ` mutation can never replay again`
      );
    case "bad-pattern":
      return `  -t ${JSON.stringify(fault.pattern)} is not a valid regex: ${fault.detail}`;
    case "unlistable":
      return `  -t ${JSON.stringify(fault.pattern)}: ${fault.detail}`;
    case "dead-pattern":
      return (
        `  -t ${JSON.stringify(fault.pattern)} selects NO test: vitest skips every test and` +
        ` exits 0, so a replay would read this mutation as "survived" whatever the code does`
      );
  }
}

export function formatAnchorReport(report: AnchorReport): string {
  const lines: string[] = [];
  for (const fault of report.faults) {
    if (fault.kind === "unreadable" || fault.kind === "malformed") {
      lines.push(
        `${FAULT_HEADLINE[fault.kind]}  ${fault.manifest}`,
        `  ${fault.detail}`,
      );
      continue;
    }
    // The index is 0-based, which is how this repo's planning docs and lane
    // reports already cite a mutation (`mz2#3`, `ad1#0`).
    lines.push(
      `${FAULT_HEADLINE[fault.kind]}  ${fault.manifest}#${fault.index}`,
      `  file: ${fault.mutation.file}`,
      faultDetail(fault),
      `  because: ${fault.mutation.because}`,
    );
  }
  const live = report.mutations - report.retired;
  const scanned =
    `${report.manifests} manifest(s), ${report.mutations} mutation(s): ` +
    `${live} live, ${report.retired} retired.`;
  const selection =
    `${report.patterns} -t pattern(s): ${report.proved} proved by syntax, ` +
    `${report.confirmed} confirmed by vitest list in ${Math.round(report.confirmMs)}ms.`;
  lines.push(
    report.faults.length === 0
      ? `anchors: ${scanned} ${selection} Every live anchor resolves exactly once and every ` +
          `-t pattern selects a test.`
      : `anchors: ${scanned} ${selection} ${report.faults.length} fault(s) — see above. A ` +
          `mutation whose anchor does not resolve is a claim nobody is checking: re-anchor it if ` +
          `the code moved, retire it with a reason if the code is gone. A mutation whose -t ` +
          `selects nothing is worse — it reports "survived" without running anything: re-point ` +
          `the pattern at the test it means, and verify it selects before writing it.`,
  );
  return lines.join("\n");
}

export function anchorExitCode(report: AnchorReport): number {
  return report.faults.length === 0 ? EXIT_LIVE : EXIT_DEAD;
}
