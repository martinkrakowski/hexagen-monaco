import { errorText } from "../internal/artifact.js";
import type { LaneHost } from "../internal/lane-hosts.js";
import {
  BRIEF_NEW_USAGE,
  parseBriefNewArgs,
  type BriefNewArgs,
} from "./args.js";
import { render } from "./render.js";

/** Everything the command touches: the overlay's hosts, a path check, and an exclusive write. */
export interface BriefNewIo {
  readonly argv: readonly string[];
  /** The overlay's `laneHosts`, read only after the command line is judged. */
  readonly hosts: () => readonly LaneHost[];
  /** The brief itself, or the summary line when `--out` is given. */
  readonly log: (text: string) => void;
  readonly logError: (text: string) => void;
  readonly exists: (path: string) => Promise<boolean>;
  /** Must create the directory, and must fail when the file exists (`wx`). */
  readonly writeExclusive: (path: string, text: string) => Promise<void>;
}

/**
 * `brief-new --lane … --plan … --branch … --tip … --host … [--env K=V]… [--out <path>]`
 *
 * Exit codes: 0 the brief was written (or printed); 1 `--out` exists or the
 * write failed; 2 the command line is wrong or `--host` names no `laneHosts`
 * entry, decided before anything is written.
 */
export async function runBriefNew(io: BriefNewIo): Promise<number> {
  let plan: BriefNewArgs;
  try {
    plan = parseBriefNewArgs(io.argv);
  } catch (error) {
    io.logError(errorText(error));
    return 2;
  }

  const hosts = io.hosts();
  const host = hosts.find((entry) => entry.name === plan.host);
  if (host === undefined) {
    const known = hosts.map((entry) => entry.name).join(", ") || "(none)";
    io.logError(
      `--host '${plan.host}' names no laneHosts entry in the overlay. Known hosts: ${known}\n${BRIEF_NEW_USAGE}`,
    );
    return 2;
  }

  if (plan.out !== undefined) {
    let taken: boolean;
    try {
      taken = await io.exists(plan.out);
    } catch (error) {
      io.logError(
        `could not check whether ${plan.out} exists, so nothing was written: ${errorText(error)}`,
      );
      return 1;
    }
    if (taken) {
      io.logError(
        `refusing to write: ${plan.out} already exists — give this lane its own --out`,
      );
      return 1;
    }
  }

  const brief = render({
    lane: plan.lane,
    plan: plan.plan,
    branch: plan.branch,
    tip: plan.tip,
    host: host.name,
    gate: host.gate,
    env: plan.env,
  });

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
  io.log(
    `wrote ${plan.out} — lane ${plan.lane}, host ${host.name} (gate: ${host.gate})`,
  );
  return 0;
}

export { BRIEF_NEW_USAGE };
