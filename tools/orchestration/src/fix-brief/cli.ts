import { errorText, fetchAllThreads } from "../sweep/lib/sweep.js";
import type { RepoRef } from "../sweep/lib/types.js";
import {
  FIX_BRIEF_USAGE,
  parseFixBriefArgs,
  type FixBriefArgs,
} from "./args.js";
import { render } from "./render.js";

/** Everything the command touches: the forge, a path check, and an exclusive write. */
export interface FixBriefIo {
  readonly argv: readonly string[];
  /** The one repository the threads are read from. */
  readonly repo: RepoRef;
  readonly gh: (args: readonly string[]) => Promise<string>;
  /** The brief itself, or the summary line when `--out` is given. */
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly exists: (path: string) => Promise<boolean>;
  /** Must fail when the file exists (`wx`). */
  readonly writeExclusive: (path: string, text: string) => Promise<void>;
}

/**
 * `fix-brief --pr <n> --round <k> --lane … --worktree … --branch … --tip … [--out <path>]`
 *
 * Exit codes: 0 the brief was written (or printed); 1 a refusal — `--out`
 * exists, the threads could not be read in full, the PR could not be read, or
 * the write failed — with every reason listed and nothing written; 2 the
 * command line itself is wrong, decided before the first forge call.
 *
 * It is read-only on the forge: the one request it makes is the threads query,
 * through the same paginated, fail-closed fetch `sweep` uses, so a brief is
 * never drafted from half a PR.
 */
export async function runFixBrief(io: FixBriefIo): Promise<number> {
  let plan: FixBriefArgs;
  try {
    plan = parseFixBriefArgs(io.argv);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }

  // The pre-check comes before the fetch: a run that would refuse its output
  // should not spend a forge round-trip first.
  if (plan.out !== undefined && (await io.exists(plan.out))) {
    io.logError(
      `refusing to write: ${plan.out} already exists — give this round its own --out`,
    );
    return 1;
  }

  const fetched = await fetchAllThreads(plan.pr, io.gh, io.repo);
  if (fetched.failures.length > 0) {
    io.logError(
      `the fetch of PR #${plan.pr} returned errors, so no brief was drafted:`,
    );
    for (const reason of fetched.failures) io.logError(`  ${reason}`);
    return 1;
  }
  if (fetched.prId === undefined) {
    io.logError(
      `PR #${plan.pr} does not exist or is not readable — no brief was drafted`,
    );
    return 1;
  }

  const open = fetched.threads.filter((thread) => !thread.isResolved);
  if (open.length === 0) {
    io.logError(
      `PR #${plan.pr} has no unresolved threads; the brief lists no items`,
    );
  }
  const brief = render(plan, open);

  if (plan.out === undefined) {
    io.log(brief);
    return 0;
  }
  try {
    await io.writeExclusive(plan.out, `${brief}\n`);
  } catch (error) {
    io.logError(`could not write ${plan.out}: ${errorText(error)}`);
    return 1;
  }
  io.log(`wrote ${plan.out} — ${open.length} item(s) from PR #${plan.pr}`);
  return 0;
}

export { FIX_BRIEF_USAGE };
