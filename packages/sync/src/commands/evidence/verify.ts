import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ProposalMeta,
  Tip,
  checkGrantWindow,
  isPathInSlice,
  nfc,
  type Grant,
  type Slice,
} from "@hexagen/shared";
import {
  readGrantKey,
  readSliceEngagementId,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  lineHash,
  splitTrace,
  verifyTip,
} from "@hexagen/shared/node/trace-chain";
import { loadGrantFile, verifyGrantSignature } from "../grant/verify.js";
import { createGitReader } from "../report/exec-git.js";
import {
  changedPaths,
  git,
  isAncestor,
  loadSlice,
} from "../shared/brownfield-sidecar.js";
import { checkLines, describeVerdict, type LineVerdict } from "./check.js";

/**
 * `hexagen evidence verify`: the unaccounted-mutation check.
 *
 * A change to a file the kit governs — inside the slice (minus its excludes) or
 * inside any supplied grant's `paths` — with no matching Trace line is a
 * defect, found after the fact. Nothing here stops a write: no editor or shell
 * write ever becomes a Transaction, so no write-time adapter can judge it. The
 * command reads the git range, verifies the trace exactly as `evidence pack`
 * does (calling what it calls), and then joins each changed file to the line
 * that claims it.
 *
 * The join is Option D: no Trace field was added. A line's paths are read back
 * from `.hexagen/proposals/<id>.json`, which the propose writer already stores
 * beside the line with that line's `seq`, and `result_digest` is recomputed
 * over `JSON.stringify({ halt_reason, proposal_id, paths })` so the paths are
 * proven to be bound into the chain rather than merely asserted. Until the
 * Option A follow-on lands, a change applied through
 * `hexagen_accept_transaction` is unaccounted here, because that writer leaves
 * no path list at all.
 *
 * Two things make the evidence worth reading, and both are why this reads the
 * `<until>` tree rather than the checkout:
 *
 * - **Only anchored lines cover.** The chain binds every line to the one above
 *   it, but only `tip.json` binds the head to the engagement key. A line above
 *   `tip.seq` is a chain any editor could have extended, so it covers nothing;
 *   a run that would otherwise pass on one says so and names the pack that
 *   anchors it.
 * - **The evidence is the tree, not the working copy.** A trace, tip or
 *   proposal that is not committed at `<until>` is not evidence for the range,
 *   and a rewritten base commit is caught by comparing the line the trace had at
 *   `<since>` with the one it has now. A committed blob cannot change under the
 *   command, so no trace lock is taken.
 */

const TRACE_RELATIVE = [".hexagen", "evidence", "trace.jsonl"];
const TIP_RELATIVE = [".hexagen", "evidence", "tip.json"];
const PROPOSALS_RELATIVE = ".hexagen/proposals";

/** Named verbatim: without staged evidence there is nothing to judge. */
const STAGE_HINT = [
  "stage the kit's evidence into this checkout first:",
  "  hexagen workbook export --stage .hexagen/slice.json \\",
  "    .hexagen/evidence/trace.jsonl \\",
  "    .hexagen/evidence/tip.json \\",
  "    .hexagen/grants/<id>.json \\",
  "    .hexagen/proposals/<id>.json \\",
  "    --yes",
].join("\n");

/** Named verbatim: only a key-holder's pack can anchor a line. */
const PACK_HINT =
  "hexagen evidence pack .hexagen/evidence/trace.jsonl --grant <file>... --out <zip>";

export interface EvidenceVerifyOptions {
  /** Repo root; `.hexagen/` lives here. Never searched upward. */
  readonly root: string;
  /** Any git ref; only lines appended after it can cover anything. */
  readonly since: string;
  /** Upper end of the range. Defaults to `HEAD`. */
  readonly until?: string;
  /** Grant file(s) the trace's lines may cite, and whose paths widen scope. */
  readonly grantFiles: readonly string[];
  readonly keyFile?: string;
  readonly engagement?: string;
  /** Treat an empty diff as a pass instead of a precondition failure. */
  readonly allowEmpty?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

/** One changed file no anchored line covers, with the nearest line that does. */
export interface UnaccountedFile {
  readonly path: string;
  /**
   * Lines that would cover `path` but that no `evidence pack` has anchored.
   * Present only when the run failed because the cover exists on paper only.
   */
  readonly unanchoredCover?: readonly number[];
  readonly nearestSeq?: number;
  readonly nearestGrantId?: string;
  readonly nearestPaths?: readonly string[];
}

export interface EvidenceVerifyResult {
  /** 0 nothing unaccounted; 1 a change has no line; 2 bad input or bad state. */
  readonly exitCode: 0 | 1 | 2;
  /** Status lines, printed to stderr. */
  readonly messages: readonly string[];
  /** The unaccounted paths, one per line, printed to stdout. */
  readonly stdout?: string;
  readonly unaccounted?: readonly UnaccountedFile[];
  /** The kept paths that a candidate line does cover. */
  readonly covered?: readonly string[];
  /** Raw changed paths outside the slice and every supplied grant. */
  readonly skipped?: number;
  /** Lines appended after `--since` that are valid completed evidence. */
  readonly candidateLines?: number;
}

/** A joined line: the valid evidence line and the proposal that claims it. */
export interface CandidateLine {
  readonly seq: number;
  readonly grantId: string;
  /** The proposal's paths, in the order the writer recorded them. */
  readonly paths: readonly string[];
  /** `result_digest` recomputed from the joined proposal. */
  readonly digest: string;
  /** The line's calls as written; the covering one names the paths. */
  readonly calls: readonly {
    readonly result_digest: string;
    readonly time: string;
  }[];
  /**
   * A key-holder's `evidence pack` anchored this line (`seq <= tip.seq` with the
   * tip's HMAC verified). An unanchored line covers nothing.
   */
  readonly anchored: boolean;
}

const usage = (messages: readonly string[]): EvidenceVerifyResult => ({
  exitCode: 2,
  messages,
});

const sha256Hex = (data: string): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * The digest the propose writer recorded for its own result: insertion order,
 * never a canonical form, so the same object re-serialised in another key order
 * does not match. Rebuilding it is the whole point of Option D — the reader
 * proves the paths it is about to believe are the ones the chained line signed.
 */
const proposalDigest = (id: string, paths: readonly string[]): string =>
  `sha256:${sha256Hex(
    JSON.stringify({ halt_reason: "completed", proposal_id: id, paths }),
  )}`;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const joinRef = (since: string, until: string): string => `${since}..${until}`;

function resolveCommit(root: string, ref: string): string | null {
  const out = git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  return out === null || out.trim() === "" ? null : out.trim();
}

/** A ref git cannot resolve: a shallow clone never passes, it exits 2. */
function unresolvable(root: string, ref: string): string {
  const shallow =
    git(root, ["rev-parse", "--is-shallow-repository"])?.trim() === "true";
  return shallow
    ? `${ref} cannot be resolved: this is a shallow clone and the commit it names is not in the history here (fetch it: git fetch --unshallow). Judging the range it could not read would be judging nothing.`
    : `${ref} does not name a commit in ${root}`;
}

/** The highest `seq` in a trace blob, or -1 when it holds no chained line. */
function lastSeqIn(text: string): number {
  let last = -1;
  for (const line of splitTrace(text).lines) {
    const value = line.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const seq = (value as Record<string, unknown>).seq;
    if (typeof seq === "number" && Number.isInteger(seq)) {
      last = Math.max(last, seq);
    }
  }
  return last;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function callsOf(
  line: Record<string, unknown>,
): { result_digest: string; time: string }[] {
  const calls = line.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((raw) => {
    const record = asRecord(raw);
    return typeof record?.result_digest === "string" &&
      typeof record.time === "string"
      ? [{ result_digest: record.result_digest, time: record.time }]
      : [];
  });
}

/**
 * Whether `candidate` covers `file`. Three things must hold, and the path and
 * the time always come from the same record:
 *
 * 1. the joined proposal names `file`, exactly as the writer recorded it (both
 *    sides NFC-normalised, so a tree that spells a name in NFD and a proposal
 *    that spells it in NFC still name one file);
 * 2. `file` sits inside *that* line's grant's paths — coverage is scoped to one
 *    grant, so a file another supplied grant allows is not covered here;
 * 3. one of the line's calls carries the proposal's recomputed digest and sits
 *    inside that grant's window at its own time (`checkGrantWindow`, the same
 *    function the accept path and `grant check` call). A call that names the
 *    paths out of window does not cover them.
 */
export function coveringLine(
  candidate: CandidateLine,
  grant: Grant,
  file: string,
): boolean {
  const wanted = nfc(file);
  if (!candidate.paths.some((p) => nfc(p) === wanted)) return false;
  if (!isPathInSlice({ paths: grant.paths, excludes: [] }, file)) return false;
  return candidate.calls.some((call) => {
    if (call.result_digest !== candidate.digest) return false;
    const at = new Date(call.time);
    // An unparsable time proves nothing; the whole-trace pass already refuses
    // such a line under Rule 4, and a window compared against a null is not a
    // check.
    if (Number.isNaN(at.getTime())) return false;
    return checkGrantWindow(grant, at).allowed;
  });
}

/** The candidate line nearest `file`: its own directory first, then any. */
function nearestTo(
  candidates: readonly CandidateLine[],
  file: string,
): CandidateLine | undefined {
  const bySeq = [...candidates].reverse();
  const dir = path.posix.dirname(file);
  return (
    bySeq.find((c) => c.paths.some((p) => path.posix.dirname(p) === dir)) ??
    bySeq.find((c) => c.paths.length > 0)
  );
}

/**
 * Every proposal under `.hexagen/proposals/` **in the `<until>` tree**, joined
 * to its line. A proposal that is only in the working tree is not evidence for
 * the range, so it is invisible here and its line covers nothing.
 *
 * Only a proposal naming a line above `lastSeqAtSince` can be a candidate, so
 * only those are read strictly: an older one — schema or digest — covers
 * nothing and is ignored, rather than refusing every later run forever.
 */
async function joinProposals(
  root: string,
  until: string,
  lastSeqAtSince: number,
  tipSeq: number,
  lines: readonly { readonly value?: unknown }[],
  verdicts: readonly LineVerdict[],
): Promise<{
  readonly joined: ReadonlyMap<number, CandidateLine>;
  readonly problem?: string;
}> {
  const joined = new Map<number, CandidateLine>();
  const listed = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    until,
    "--",
    PROPOSALS_RELATIVE,
  ]);
  if (listed === null) {
    return {
      joined,
      problem: `git ls-tree ${until} -- ${PROPOSALS_RELATIVE} failed`,
    };
  }
  const reader = createGitReader(root);
  const names = listed
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.endsWith(".json"));
  for (const file of names.sort()) {
    const text = reader.show(until, file);
    if (text === null) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return {
        joined,
        problem: `${file}: cannot be read as JSON: ${(error as Error).message}`,
      };
    }
    const parsed = ProposalMeta.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        joined,
        problem: `${file} is not a proposal: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
      };
    }
    const meta = parsed.data;
    // A proposal from before `<since>`, and one written while the trace was
    // unchained, can never join a line that can cover this range.
    if (meta.traceSeq === null || meta.traceSeq <= lastSeqAtSince) continue;
    const verdict = verdicts.find((v) => (v.seq ?? v.index) === meta.traceSeq);
    const line = asRecord(lines[meta.traceSeq]?.value);
    // No line at that seq, or a line that is not evidence of a write: nothing
    // is covered. A proposal written under another grant than the line cites
    // covers nothing either, and is not a forgery of this line. A denial line
    // is never a candidate either, which is what `kind: "evidence"` means, so
    // it is not re-tested here.
    if (verdict === undefined || line === undefined) continue;
    if (verdict.grantId !== meta.grantId) continue;
    const digest = proposalDigest(meta.id, meta.paths);
    const calls = callsOf(line);
    if (!calls.some((call) => call.result_digest === digest)) {
      return {
        joined,
        problem: `${file}: its paths do not reproduce the result_digest of the line at seq ${meta.traceSeq} it names, so they are not bound into the chain. The trace and the proposal metadata disagree; neither is trusted.`,
      };
    }
    joined.set(meta.traceSeq, {
      seq: meta.traceSeq,
      grantId: verdict.grantId ?? meta.grantId,
      paths: meta.paths,
      digest,
      calls,
      anchored: meta.traceSeq <= tipSeq,
    });
  }
  return { joined };
}

export async function runEvidenceVerify(
  options: EvidenceVerifyOptions,
): Promise<EvidenceVerifyResult> {
  const root = path.resolve(options.root);
  const env = options.env ?? process.env;
  const untilRef = options.until ?? "HEAD";

  // The range first: a `<since>` this checkout cannot resolve is a shallow clone
  // or a bad ref, and neither may pass as "nothing changed".
  const since = resolveCommit(root, options.since);
  if (since === null) return usage([unresolvable(root, options.since)]);
  const until = resolveCommit(root, untilRef);
  if (until === null) return usage([unresolvable(root, untilRef)]);
  const range = joinRef(options.since, untilRef);
  // The range has to run forwards: `since..until` with `until` behind `since`
  // is not a range of work, and reading it backwards would let a change be
  // judged against evidence that predates it.
  if (!isAncestor(root, since, until)) {
    return usage([
      `since is not an ancestor of until: ${options.since} is not in the history of ${untilRef}. Verifying ${range} would judge a change against evidence from before it.`,
    ]);
  }

  // The staging precondition: without the slice there is nothing to judge, and
  // naming every file unaccounted would be a false alarm.
  const sliceFile = path.join(root, ".hexagen", "slice.json");
  if (
    !(await fs.lstat(sliceFile).then(
      () => true,
      () => false,
    ))
  ) {
    return usage([`no slice at ${sliceFile}; nothing was judged.`, STAGE_HINT]);
  }

  let slice: Slice;
  try {
    slice = await loadSlice(root);
  } catch (error) {
    return usage([(error as Error).message]);
  }

  if (options.grantFiles.length === 0) {
    return usage(["at least one --grant <file> is required"]);
  }
  // The engagement key first, as `evidence pack` does: without it no grant can
  // be trusted and no tip can be checked.
  const resolved = resolveGrantKey({
    keyFile: options.keyFile,
    env,
    engagementId: options.engagement ?? readSliceEngagementId(root),
    workspaceRoot: root,
    homeDir: options.homeDir,
  });
  if (resolved.path === null) {
    return usage([`cannot locate the engagement key: ${resolved.problem}`]);
  }
  const key = readGrantKey(resolved.path);
  if (!key.ok) return usage([`engagement key unusable: ${key.problem}`]);
  const keyHex = key.keyHex;

  const grants = new Map<string, Grant>();
  for (const file of options.grantFiles) {
    const loaded = await loadGrantFile(path.resolve(file));
    if (!loaded.ok) return usage([loaded.problem]);
    const signature = verifyGrantSignature(loaded.grant, {
      workspaceRoot: root,
      keyFile: options.keyFile,
      engagement: options.engagement,
      env,
      homeDir: options.homeDir,
    });
    if (!signature.verified) {
      return usage([
        `grant '${loaded.grant.id}' (${file}): signature does not verify with the engagement key (${signature.reason})`,
      ]);
    }
    if (grants.has(loaded.grant.id)) {
      return usage([`grant id '${loaded.grant.id}' is given twice`]);
    }
    grants.set(loaded.grant.id, loaded.grant);
  }

  const changed = changedPaths(root, since, until);
  if (changed === null) {
    return usage([
      `git diff ${range} failed; cannot tell what changed, so nothing was judged`,
    ]);
  }

  // Step 2: a file the kit does not govern is intentionally not judged, and the
  // skipped count makes the scope visible. A rename or copy is two paths and
  // each is judged on its own.
  const inScope = (candidate: string): boolean =>
    isPathInSlice(slice, candidate) ||
    [...grants.values()].some((grant) =>
      isPathInSlice({ paths: grant.paths, excludes: [] }, candidate),
    );
  const kept: string[] = [];
  let skipped = 0;
  for (const record of changed) {
    for (const candidate of [record.path, record.oldPath]) {
      if (candidate === undefined) continue;
      if (inScope(candidate)) kept.push(candidate);
      else skipped += 1;
    }
  }
  kept.sort();

  const skipNote = `skipped ${plural(skipped, "change")} outside the slice and every grant`;

  // The evidence is read from the `<until>` tree, so it cannot change under the
  // command and no trace lock is taken: a committed blob is either there or it
  // is not, and what the working copy holds is none of this command's business.
  const reader = createGitReader(root);
  const traceRel = TRACE_RELATIVE.join("/");
  const tipRel = TIP_RELATIVE.join("/");
  const traceText = reader.show(until, traceRel);
  if (traceText === null) {
    return usage([
      `no trace at ${traceRel} in ${untilRef}; nothing was judged. An unstaged trace is not evidence for this range.`,
      STAGE_HINT,
    ]);
  }
  const split = splitTrace(traceText);
  if (split.lines.length === 0) {
    return usage([
      `the trace at ${traceRel} in ${untilRef} has no lines; there is nothing to judge.`,
      STAGE_HINT,
    ]);
  }

  // The same pass `evidence pack` runs: chain, line shape, the four Rules, and
  // the anchored tip.
  const problems: string[] = [];
  if (split.torn) {
    problems.push(
      "the last line is torn (invalid JSON or no trailing newline)",
    );
  }
  const verdicts = checkLines(split.lines, grants);
  for (const v of verdicts) if (!v.valid) problems.push(describeVerdict(v));

  // The tip is required, not optional: it is the only thing that binds a line to
  // the engagement key, and a run that cannot see it cannot tell evidence from a
  // hand-written chain.
  const tipText = reader.show(until, tipRel);
  if (tipText === null) {
    return usage([
      `no anchored tip at ${tipRel} in ${untilRef}; nothing was judged. Only a line a key-holder's pack anchored can cover a change, so anchor the head first: ${PACK_HINT}`,
    ]);
  }
  let tip: Tip | undefined;
  try {
    tip = Tip.parse(JSON.parse(tipText));
  } catch (error) {
    problems.push(`${tipRel} is not a valid tip: ${(error as Error).message}`);
  }
  let tipSeq = -1;
  if (tip) {
    if (!verifyTip(tip, keyHex)) {
      problems.push("tip.json HMAC does not verify with the engagement key");
    } else {
      tipSeq = tip.seq;
      const at = split.lines[tip.seq];
      if (at === undefined) {
        problems.push(
          `the trace ends before the recorded tip (seq ${tip.seq}): lines were removed`,
        );
      } else if (at.value === undefined || lineHash(at.value) !== tip.hash) {
        problems.push(
          `the line at the recorded tip (seq ${tip.seq}) differs from the one anchored: the trace was altered or restarted`,
        );
      }
    }
  }
  if (problems.length > 0) {
    return usage([
      `evidence verify cannot judge ${range}: the trace is not sound evidence, so no coverage was judged and nothing is called accounted:`,
      ...problems.map((p) => `  - ${p}`),
    ]);
  }

  // Only a line appended after `<since>` can cover a change made in the range.
  // The trace has to have been tracked at `<since>` for that to be decidable:
  // neither a call's own clock nor an adjusted commit date proves a line was
  // appended after it, and a stale line must never cover a new change.
  const trackedAtSince = reader.show(since, traceRel);
  if (trackedAtSince === null) {
    return usage([
      `the trace is not tracked at ${options.since} (${traceRel}); only lines appended after it could cover a change, and this checkout cannot tell which those are. Refusing to guess.`,
      STAGE_HINT,
    ]);
  }
  const atSince = splitTrace(trackedAtSince).lines;
  const lastSeqAtSince = lastSeqIn(trackedAtSince);
  // Freshness is a history claim, not a number: the trace now has to *be* the
  // trace it was at `<since>`, continued. A rewritten, reordered or replaced
  // base commit breaks that, and a `seq` comparison would not notice.
  if (lastSeqAtSince >= 0) {
    const then = atSince[lastSeqAtSince]?.value;
    const now = split.lines[lastSeqAtSince]?.value;
    if (
      then === undefined ||
      now === undefined ||
      lineHash(then) !== lineHash(now)
    ) {
      return usage([
        `trace rewritten since ${options.since}: the line at seq ${lastSeqAtSince} is not the one the trace held there, so the chain says nothing about ${range}.`,
      ]);
    }
  }
  const candidateVerdicts = verdicts.filter(
    (v) => v.kind === "evidence" && (v.seq ?? v.index) > lastSeqAtSince,
  );

  // A clean result never means "nothing was looked at" by default.
  if (changed.length === 0) {
    const line = "empty diff: nothing was checked";
    return options.allowEmpty === true
      ? { exitCode: 0, messages: [line], stdout: "" }
      : usage([line, "re-run with --allow-empty to accept an empty range"]);
  }

  const { joined, problem } = await joinProposals(
    root,
    until,
    lastSeqAtSince,
    tipSeq,
    split.lines,
    verdicts,
  );
  if (problem !== undefined) return usage([problem]);

  const candidates: CandidateLine[] = candidateVerdicts.flatMap((v) => {
    const candidate = joined.get(v.seq ?? v.index);
    return candidate === undefined ? [] : [candidate];
  });
  const anchored = candidates.filter((c) => c.anchored);

  const covered: string[] = [];
  const unaccounted: UnaccountedFile[] = [];
  for (const file of kept) {
    const covering = (candidate: CandidateLine): boolean => {
      const grant = grants.get(candidate.grantId);
      // Narrowing, not a second check: Rule 3 already refused every line
      // citing a grant no supplied file verifies, so the map always answers.
      return grant !== undefined && coveringLine(candidate, grant, file);
    };
    if (anchored.some(covering)) {
      covered.push(file);
      continue;
    }
    // A line that would cover it, but that no pack has anchored, is the case
    // worth naming: the work is accounted for on paper and not in fact.
    const unanchored = candidates.filter((c) => !c.anchored && covering(c));
    const nearest = nearestTo(candidates, file);
    unaccounted.push({
      path: file,
      unanchoredCover: unanchored.map((c) => c.seq),
      ...(nearest === undefined
        ? {}
        : {
            nearestSeq: nearest.seq,
            nearestGrantId: nearest.grantId,
            nearestPaths: nearest.paths,
          }),
    });
  }

  const nearestNote = (entry: UnaccountedFile): string => {
    const unanchored =
      entry.unanchoredCover !== undefined && entry.unanchoredCover.length > 0
        ? `cover exists but is not anchored: run hexagen evidence pack (seq ${entry.unanchoredCover.join(", ")}); `
        : "";
    if (entry.nearestSeq === undefined) {
      return `${unanchored}no line was appended after --since at all`;
    }
    return `${unanchored}nearest line appended after --since: seq ${entry.nearestSeq} under grant ${entry.nearestGrantId}, which named ${(entry.nearestPaths ?? []).join(", ")}`;
  };
  const summary = `${plural(covered.length + unaccounted.length, "in-scope change")} judged, ${plural(covered.length, "change")} covered by a line appended after ${options.since}; ${skipNote}`;
  const messages =
    unaccounted.length === 0
      ? [`evidence verify ok: ${summary}`]
      : [
          `evidence verify FAILED: ${plural(unaccounted.length, "change")} found after the fact in ${range} with no covering line`,
          ...unaccounted.map(
            (entry) => `  unaccounted: ${entry.path} (${nearestNote(entry)})`,
          ),
          `  ${skipNote}`,
        ];
  return {
    exitCode: unaccounted.length === 0 ? 0 : 1,
    messages,
    stdout: `${unaccounted.map((u) => u.path).join("\n")}${unaccounted.length > 0 ? "\n" : ""}`,
    unaccounted,
    covered,
    skipped,
    candidateLines: candidateVerdicts.length,
  };
}
