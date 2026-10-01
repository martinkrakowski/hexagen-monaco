import type { ReviewThread } from "../sweep/lib/types.js";
import { TEMPLATE_E } from "./template-text.js";

/** The header values the brief carries. */
export interface BriefHeader {
  readonly lane: string;
  readonly round: number;
  readonly pr: number;
  readonly worktree: string;
  readonly branch: string;
  readonly tip: string;
}

/** The sample item in the template: the span the rendered items take the place of. */
const SAMPLE_ITEM_HEADING = "## Item 1 — ";
const SAMPLE_ITEM_END = "— end of quoted text for item 1 —\n";
const DISPOSITION =
  "Disposition: <fix | refute with reason — the orchestrator fills this in>";

type Placeholder =
  | "LANE"
  | "ROUND"
  | "PR"
  | "WORKTREE"
  | "BRANCH"
  | "TIP"
  | "COUNT";

/**
 * Fills the template's seven placeholders in ONE pass. Filled one name at a
 * time, the text a name introduces would be scanned for the remaining names,
 * and a value that reads `<PR>` would be substituted a second time. A single
 * replace never rescans its own output.
 */
function substitute(
  text: string,
  values: Readonly<Record<Placeholder, string>>,
): string {
  return text.replace(
    /<(LANE|ROUND|PR|WORKTREE|BRANCH|TIP|COUNT)>/g,
    (_match, name: string) => values[name as Placeholder],
  );
}

/**
 * A field off the wire rendered INLINE in a heading. A control character, a
 * line or paragraph separator, or a backtick becomes `?`: the first three would
 * end the heading's line, and a backtick would end its code quoting, so a value
 * from the forge would be writing the line it sits on rather than filling it.
 */
export function sanitiseInline(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}`]/gu, "?");
}

/** `path:line`, `path:originalLine (outdated)`, or `path (file-level)`; the label sits outside the code span. */
function anchorOf(thread: ReviewThread): string {
  const file = sanitiseInline(thread.path);
  const line = thread.isOutdated ? thread.originalLine : thread.line;
  if (line === null) return `\`${file}\` (file-level)`;
  return thread.isOutdated
    ? `\`${file}:${line}\` (outdated)`
    : `\`${file}:${line}\``;
}

/**
 * The fence for a quoted body: one backtick longer than the LONGEST backtick
 * run inside it, never fewer than three. A body carrying its own fence cannot
 * then end the quote early and have the rest read as the brief's instructions.
 */
export function fenceFor(body: string): string {
  let longest = 0;
  for (const run of body.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

const DETAILS_TAG = /<\/?details\b[^>]*>/gi;

/**
 * The label a reviewer's agent-prompt block is summarised by. Matched against
 * the block's OWN first summary, with its markup stripped and any leading
 * symbol (an emoji) skipped. The trailing `\b` keeps "Agent Prompts are
 * discussed below" out.
 */
const PROMPT_LABEL = /^[^\p{L}\p{N}]*(?:Prompt for AI Agents|Agent Prompt)\b/iu;

/** The block's own first summary: it must open the block, straight after the `<details>` tag. */
const OWN_FIRST_SUMMARY =
  /^<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i;

function isAgentPromptBlock(block: string): boolean {
  const summary = OWN_FIRST_SUMMARY.exec(block)?.[1];
  if (summary === undefined) return false;
  return PROMPT_LABEL.test(summary.replace(/<[^>]*>/g, "").trim());
}

/**
 * Every COMPLETE top-level `<details>…</details>` span, found by counting
 * depth. A non-greedy match would end at the first closing tag and leave the
 * tail of a block that contains another block outside it, in the brief. An
 * unclosed `<details>` and a stray `</details>` are not blocks and are left
 * alone.
 */
function topLevelBlocks(
  text: string,
): readonly { start: number; end: number }[] {
  const blocks: { start: number; end: number }[] = [];
  let depth = 0;
  let start = 0;
  for (const tag of text.matchAll(DETAILS_TAG)) {
    const at = tag.index;
    if (tag[0].startsWith("</")) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0) blocks.push({ start, end: at + tag[0].length });
    } else {
      if (depth === 0) start = at;
      depth += 1;
    }
  }
  return blocks;
}

/**
 * Replaces each reviewer agent-prompt block with a one-line note of how much
 * was withheld. The block is addressed to a model reading the thread and means
 * nothing to a lane fixing the finding; replacing rather than truncating means
 * no lane follows half a prompt. Everything else is kept verbatim.
 */
export function omitAgentPrompts(body: string): string {
  let kept = "";
  let copiedTo = 0;
  for (const { start, end } of topLevelBlocks(body)) {
    const block = body.slice(start, end);
    if (!isAgentPromptBlock(block)) continue;
    kept += body.slice(copiedTo, start);
    kept += `[agent prompt omitted: ${block.length} characters]`;
    copiedTo = end;
  }
  return kept + body.slice(copiedTo);
}

function item(n: number, thread: ReviewThread): string {
  const quote = omitAgentPrompts(thread.body);
  const fence = fenceFor(quote);
  return [
    `## Item ${n} — ${sanitiseInline(thread.id)} — ${sanitiseInline(thread.author)} — ${anchorOf(thread)}`,
    DISPOSITION,
    fence,
    quote,
    fence,
    `— end of quoted text for item ${n} —`,
    "",
  ].join("\n");
}

/**
 * The whole brief: Template E with its placeholders filled and its sample item
 * replaced by one block per thread, in the order given. The count comes from
 * the items themselves, so a header cannot claim more than follow.
 */
export function render(
  header: BriefHeader,
  threads: readonly ReviewThread[],
): string {
  const start = TEMPLATE_E.indexOf(SAMPLE_ITEM_HEADING);
  const end = TEMPLATE_E.indexOf(SAMPLE_ITEM_END, start);
  if (start === -1 || end === -1) {
    throw new Error("the fix-brief template has lost its sample item");
  }
  const values: Readonly<Record<Placeholder, string>> = {
    LANE: header.lane,
    ROUND: String(header.round),
    PR: String(header.pr),
    WORKTREE: header.worktree,
    BRANCH: header.branch,
    TIP: header.tip,
    COUNT: String(threads.length),
  };
  const head = substitute(TEMPLATE_E.slice(0, start), values);
  const footer = substitute(
    TEMPLATE_E.slice(end + SAMPLE_ITEM_END.length),
    values,
  );
  const items = threads.map((thread, i) => item(i + 1, thread)).join("\n");
  return `${head}${items}${footer}`;
}
