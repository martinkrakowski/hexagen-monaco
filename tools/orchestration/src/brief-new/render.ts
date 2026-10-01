import type { LaneHostGate } from "../internal/lane-hosts.js";
import { fenceFor } from "../fix-brief/render.js";
import { TEMPLATE_A } from "./template-text.js";

/** What the brief carries: the command line's answers, and the host's gate policy. */
export interface BriefHeader {
  readonly lane: string;
  readonly plan: string;
  readonly branch: string;
  readonly tip: string;
  readonly host: string;
  readonly gate: LaneHostGate;
  /** Remote hosts (`ssh`, `clone` or `worktrees`) never push, whatever their gate. */
  readonly remote: boolean;
  readonly env: readonly string[];
}

/** The variant paragraph: from its first words to the sentence that ends it. */
const VARIANT_START = "Lane-host variant. ";
const VARIANT_END = "ignore this paragraph.\n";
/** The line after which the environment block is inserted: the worktree line. */
const ENV_AFTER = "\n\nRead first, in order:";

type Placeholder = "LANE" | "PLAN_PATH" | "BRANCH" | "SHA";

/**
 * Fills the four placeholders the command line answers in ONE pass, so a value
 * that reads `<BRANCH>` is never substituted a second time. The rest
 * (`<N>`, `<REPO_PATH>`, `<WORKTREE_PATH>`, `<SECTIONS>`, ...) stay for the
 * orchestrator: they are not facts the command line holds.
 */
function substitute(
  text: string,
  values: Readonly<Record<Placeholder, string>>,
): string {
  return text.replace(
    /<(LANE|PLAN_PATH|BRANCH|SHA)>/g,
    (_match, name: string) => values[name as Placeholder],
  );
}

/** The lead for a remote host whose gate is `full`: it still commits only. */
function remoteFullLead(host: string): string {
  return (
    `Gate policy. This brief names the lane host \`${host}\`, which is remote and has \`gate: full\`. ` +
    "The lane-host variant below APPLIES: commit only, never push. You do not run the full gate; " +
    "the orchestrator runs the full gate after fetching your commits, then pushes and opens the PR.\n\n"
  );
}

/** The paragraph that replaces the variant when the host reproduces the full gate. */
function fullGateParagraph(host: string): string {
  return (
    `Gate policy. This brief names the lane host \`${host}\`, which has \`gate: full\`. ` +
    "The lane-host variant does not apply. Before pushing, run the full gate " +
    "(`npx --no-install hexagen-orchestration-gate`) in the lane's own worktree, " +
    "on the tree you are about to push, and report its exit code.\n"
  );
}

/** The line that makes the variant paragraph apply, named for the host that asked for it. */
function targetedOnlyLead(host: string): string {
  return (
    `Gate policy. This brief names the lane host \`${host}\`, which has \`gate: targeted-only\`. ` +
    "The lane-host variant below APPLIES, and the full gate must NOT be run on this host.\n\n"
  );
}

/**
 * The whole brief: Template A with the command line's four placeholders filled,
 * its lane-host variant resolved against the host's gate policy, and the
 * operator's `--env` lines written in verbatim. Each piece is substituted on its
 * own and assembled afterwards, so text the operator or the overlay supplied is
 * never scanned for placeholders.
 */
export function render(header: BriefHeader): string {
  const vStart = TEMPLATE_A.indexOf(VARIANT_START);
  const vEnd = TEMPLATE_A.indexOf(VARIANT_END, vStart);
  const envAt = TEMPLATE_A.indexOf(ENV_AFTER);
  if (vStart === -1 || vEnd === -1 || envAt === -1 || envAt > vStart) {
    throw new Error("the brief-new template has lost its lane-host variant");
  }
  const variantEnd = vEnd + VARIANT_END.length;
  const values: Readonly<Record<Placeholder, string>> = {
    LANE: header.lane,
    PLAN_PATH: header.plan,
    BRANCH: header.branch,
    SHA: header.tip,
  };
  const fill = (text: string): string => substitute(text, values);

  let envBlock = "";
  if (header.env.length > 0) {
    const body = header.env.join("\n");
    const fence = fenceFor(body);
    envBlock = `\n\nEnvironment. Set these in every command you run:\n${fence}\n${body}\n${fence}`;
  }

  const variant = TEMPLATE_A.slice(vStart, variantEnd);
  const gate =
    header.gate === "targeted-only"
      ? `${targetedOnlyLead(header.host)}${fill(variant)}`
      : header.remote
        ? `${remoteFullLead(header.host)}${fill(variant)}`
        : fullGateParagraph(header.host);

  return (
    fill(TEMPLATE_A.slice(0, envAt)) +
    envBlock +
    fill(TEMPLATE_A.slice(envAt, vStart)) +
    gate +
    fill(TEMPLATE_A.slice(variantEnd))
  );
}
