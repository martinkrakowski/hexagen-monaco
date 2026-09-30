import { repoFlag, type RepoRef } from "./types.js";
import { errorText, fetchAllThreads } from "./sweep.js";
import type { AttributeArgs } from "./args.js";

/**
 * The three review-agent workflow *names* as GitHub Actions records them. All
 * three post as `github-actions[bot]` with no marker in the comment, so the
 * name on the check run — not the thread — is what splits them.
 *
 * These are this project's own workflow names and they are published on
 * purpose: this repository runs the same review agent, and an operator
 * splitting a bot thread from a workflow they already run is reading a name
 * their own CI registers. They are a classifier over check-run names, not a
 * reference to any one repository's setup.
 */
export const PR_AGENT_WORKFLOWS = [
  { name: "PR-Agent UI Review", key: "UI" },
  { name: "PR-Agent API Review", key: "API" },
  { name: "PR-Agent Architecture Review", key: "Architecture" },
] as const;

export type WorkflowKey = (typeof PR_AGENT_WORKFLOWS)[number]["key"];
export type Attribution = WorkflowKey | "unattributed";

export type AttributeDecision =
  | { readonly kind: "ok"; readonly lines: readonly string[] }
  | { readonly kind: "fail"; readonly reasons: readonly string[] };

export interface AttributeDeps {
  readonly gh: (args: readonly string[]) => Promise<string>;
  /** The one repository every call is pointed at. */
  readonly repo: RepoRef;
}

const SUGGESTION_TRAIL = /\s*\[([^,\]]+),\s*importance:\s*\d+\]/;

export function normaliseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The text between `**Suggestion:**` and the trailing `[label, importance: n]`,
 * whitespace-normalised. Null when the first comment is not that shape — a
 * body we cannot match is unattributed, never a guess at nearby prose.
 */
export function suggestionOf(body: string): string | null {
  const marker = "**Suggestion:**";
  const at = body.indexOf(marker);
  if (at < 0) return null;
  const rest = body.slice(at + marker.length);
  const trail = rest.match(SUGGESTION_TRAIL);
  if (trail === null) return null;
  const normalised = normaliseWs(rest.slice(0, trail.index));
  return normalised === "" ? null : normalised;
}

/**
 * JSON-escaped log text (`\n`, `\"`, `\u2011`) as the model wrote it. The
 * match is against this decoded form, because the thread body is plain text
 * and the job log is the JSON-escaped `{"text": "..."}` line `gh run view
 * --log` prints.
 *
 * Each JSON string is `JSON.parse`d; leftover escapes (a log line with no
 * object) are parsed the same way, one token at a time. Sequential `replace`
 * calls would decode `\\n` as a newline and turn a literal backslash-n in
 * the model's text into a false miss — or worse, a false single match.
 */
export function decodeRunLog(raw: string): string {
  return unescapeJsonEscapes(raw);
}

function parseJsonStringLiteral(quoted: string): string | null {
  try {
    // Caller passes a JSON string literal (`"..."`); parse then yields a string.
    return JSON.parse(quoted) as string;
  } catch {
    return null;
  }
}

/** A JSON string starting at `start`, or null if this `"` is not a string opener. */
function takeJsonString(
  raw: string,
  start: number,
): { value: string; end: number } | null {
  let i = start + 1;
  while (i < raw.length) {
    if (raw[i] === "\\") {
      i += 2;
      continue;
    }
    if (raw[i] === '"') {
      const value = parseJsonStringLiteral(raw.slice(start, i + 1));
      if (value === null) return null;
      return { value, end: i + 1 };
    }
    i += 1;
  }
  return null;
}

/** One JSON escape at `i` (`\n`, `\"`, `\\`, `\uXXXX`), parsed as a quoted literal. */
function takeJsonEscape(
  raw: string,
  i: number,
): { value: string; end: number } | null {
  if (raw[i] !== "\\") return null;
  const width = raw[i + 1] === "u" ? 6 : 2;
  const value = parseJsonStringLiteral(`"${raw.slice(i, i + width)}"`);
  if (value === null) return null;
  return { value, end: i + width };
}

function unescapeJsonEscapes(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      const taken = takeJsonString(raw, i);
      if (taken !== null) {
        out += taken.value;
        i = taken.end;
        continue;
      }
    }
    const escaped = takeJsonEscape(raw, i);
    if (escaped !== null) {
      out += escaped.value;
      i = escaped.end;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

function isPrAgentAuthor(login: string): boolean {
  return login.replace(/\[bot\]$/, "") === "github-actions";
}

/** `gh run list --limit` — a page that fills this is incomplete, never "the last 50". */
export const RUN_LIST_LIMIT = 50;

/** Fields `gh run list --json` must return so a reused branch name cannot pin a match. */
export const RUN_LIST_JSON_FIELDS = "databaseId,headSha,event";

function oidOf(row: unknown): string | undefined {
  if (row === null || typeof row !== "object") return undefined;
  const oid = (row as { oid?: unknown }).oid;
  return typeof oid === "string" && oid !== "" ? oid : undefined;
}

/**
 * Commit oids of the PR, as `gh pr view --json commits` returns them. An
 * unreadable list is a failure: a partial set would drop a run and can turn
 * a two-workflow match into a false single attribution.
 */
function commitShasFromView(stdout: string, pr: number): Set<string> {
  const parsed: unknown = JSON.parse(stdout);
  const commits =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { commits?: unknown }).commits
      : undefined;
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error(`the commits of PR #${pr} could not be read`);
  }
  const shas = new Set<string>();
  for (const row of commits) {
    const oid = oidOf(row);
    if (oid === undefined) {
      throw new Error(`the commits of PR #${pr} could not be read`);
    }
    shas.add(oid);
  }
  return shas;
}

function runIdsFromList(
  stdout: string,
  workflow: string,
  commitShas: ReadonlySet<string>,
): number[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error(`run list for ${workflow} was not a JSON array`);
  }
  if (parsed.length === RUN_LIST_LIMIT) {
    throw new Error(
      `run list for ${workflow} was truncated at ${String(RUN_LIST_LIMIT)} — older runs were not searched`,
    );
  }
  const ids: number[] = [];
  for (const row of parsed) {
    const rec = row as { databaseId?: unknown; headSha?: unknown };
    const id = rec.databaseId;
    if (typeof id !== "number") {
      throw new Error(
        `run list for ${workflow} carried a row with no databaseId`,
      );
    }
    const headSha = rec.headSha;
    if (typeof headSha !== "string" || headSha === "") {
      throw new Error(`run list for ${workflow} carried a row with no headSha`);
    }
    if (!commitShas.has(headSha)) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Attribute each `github-actions` review thread to the PR-Agent workflow
 * whose decoded job log contains that thread's suggestion text.
 *
 * Exactly one matching workflow → that workflow; none or several →
 * `unattributed`. A partial read (threads, commits, a truncated run list,
 * or a log) is a failure, not a split of what happened to come back — same
 * fail-closed rule as `gate`. Runs are kept only when `headSha` is a commit
 * of this PR; a reused head-branch name cannot import an older PR's log.
 *
 * Coverage that stays `unattributed` (safe, not a guess): UI reviews
 * triggered by an `/improve` comment (`issue_comment`) run on the default
 * branch, so they are not among the PR's commits; an Architecture run
 * whose log carries no model response has nothing to match.
 */
export async function attribute(
  plan: AttributeArgs,
  deps: AttributeDeps,
): Promise<AttributeDecision> {
  const fetched = await fetchAllThreads(plan.pr, deps.gh, deps.repo);
  if (fetched.failures.length > 0) {
    return {
      kind: "fail",
      reasons: [
        `could not attribute — the review threads of PR #${plan.pr} could not be read: ${fetched.failures.join("; ")}`,
      ],
    };
  }
  if (fetched.prId === undefined) {
    return {
      kind: "fail",
      reasons: [
        `could not attribute — PR #${plan.pr} is not readable, so its threads are unknown`,
      ],
    };
  }

  let branch: string;
  try {
    branch = (
      await deps.gh([
        "pr",
        "view",
        String(plan.pr),
        "--json",
        "headRefName",
        "--jq",
        ".headRefName",
        "--repo",
        repoFlag(deps.repo),
      ])
    ).trim();
  } catch (error) {
    return {
      kind: "fail",
      reasons: [
        `could not attribute — the head branch of PR #${plan.pr} could not be read: ${errorText(error)}`,
      ],
    };
  }
  if (branch === "") {
    return {
      kind: "fail",
      reasons: [`could not attribute — PR #${plan.pr} reported no head branch`],
    };
  }

  let commitShas: Set<string>;
  try {
    const commitsRaw = await deps.gh([
      "pr",
      "view",
      String(plan.pr),
      "--json",
      "commits",
      "--repo",
      repoFlag(deps.repo),
    ]);
    commitShas = commitShasFromView(commitsRaw, plan.pr);
  } catch (error) {
    return {
      kind: "fail",
      reasons: [
        `could not attribute — the commits of PR #${plan.pr} could not be read: ${errorText(error)}`,
      ],
    };
  }

  const decodedByWorkflow: { key: WorkflowKey; decoded: string }[] = [];
  for (const wf of PR_AGENT_WORKFLOWS) {
    let ids: number[];
    try {
      const listed = await deps.gh([
        "run",
        "list",
        "--branch",
        branch,
        "--workflow",
        wf.name,
        "--json",
        RUN_LIST_JSON_FIELDS,
        "--limit",
        String(RUN_LIST_LIMIT),
        "--repo",
        repoFlag(deps.repo),
      ]);
      ids = runIdsFromList(listed, wf.name, commitShas);
    } catch (error) {
      return {
        kind: "fail",
        reasons: [
          `could not attribute — runs of ${wf.name} on ${branch} could not be listed: ${errorText(error)}`,
        ],
      };
    }
    const parts: string[] = [];
    for (const id of ids) {
      let raw: string;
      try {
        raw = await deps.gh([
          "run",
          "view",
          String(id),
          "--log",
          "--repo",
          repoFlag(deps.repo),
        ]);
      } catch (error) {
        return {
          kind: "fail",
          reasons: [
            `could not attribute — log of run ${id} could not be read: ${errorText(error)}`,
          ],
        };
      }
      parts.push(decodeRunLog(raw));
    }
    decodedByWorkflow.push({ key: wf.key, decoded: parts.join("\n") });
  }

  const counts: Record<Attribution, { threads: number; resolved: number }> = {
    UI: { threads: 0, resolved: 0 },
    API: { threads: 0, resolved: 0 },
    Architecture: { threads: 0, resolved: 0 },
    unattributed: { threads: 0, resolved: 0 },
  };
  const lines: string[] = [];
  for (const thread of fetched.threads) {
    if (!isPrAgentAuthor(thread.author)) continue;
    const suggestion = suggestionOf(thread.body);
    const matched: WorkflowKey[] = [];
    if (suggestion !== null) {
      for (const wf of decodedByWorkflow) {
        if (normaliseWs(wf.decoded).includes(suggestion)) matched.push(wf.key);
      }
    }
    const workflow: Attribution =
      matched.length === 1 ? matched[0] : "unattributed";
    const state = thread.isResolved ? "resolved" : "open";
    lines.push(`${thread.id} ${workflow} ${state}`);
    const bucket = counts[workflow];
    bucket.threads += 1;
    if (thread.isResolved) bucket.resolved += 1;
  }

  lines.push("");
  for (const key of ["UI", "API", "Architecture", "unattributed"] as const) {
    const c = counts[key];
    lines.push(`${key} ${c.threads} threads ${c.resolved} resolved`);
  }
  return { kind: "ok", lines };
}
