/**
 * `hexagen evidence verify`: the unaccounted-mutation check
 * (docs/planning/2026-10-03_kit-01-unaccounted-mutation-check.md).
 *
 * Every fixture is a real git repo in a temp directory with the `.hexagen/`
 * evidence committed, because the command judges a git range against a trace
 * file and reads that trace as of `<since>` through `git show`. The trace lines
 * are the ones the propose writer really writes: `result_digest` is the sha256
 * of `JSON.stringify({ halt_reason, proposal_id, paths })`, which is what the
 * verifier recomputes to prove the paths are bound into the chain.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Grant } from "@hexagen/shared";
import {
  appendChainedLine,
  lineHash,
  signTip,
} from "@hexagen/shared/node/trace-chain";
import {
  coveringLine,
  type CandidateLine,
  type EvidenceVerifyResult,
  runEvidenceVerify,
} from "../../../src/commands/evidence/verify.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import { cleanup, dirs, git, makeRepo, put } from "../slice/fixture.js";

const KEY = "ab".repeat(32);
/** Inside the grant window, inside the line's own window. */
const CALL_TIME = "2026-10-01T10:00:00.000Z";
const EXPIRES = "2026-12-01T00:00:00.000Z";
/** Strictly after `expires_at`: exactly at it is still in-window. */
const AFTER_EXPIRES = "2026-12-01T00:00:01.000Z";
const GRANT_REL = ".hexagen/grants/grant-1.json";
const GRANT2_REL = ".hexagen/grants/grant-2.json";

let root: string;
let keyFile: string;
let grantFile: string;
let grant2File: string;
let traceFile: string;
/** The commit `<since>` names: the `.hexagen/` evidence is committed here. */
let since: string;

const digest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** What `TraceWriteAdapter.digest` records for a propose result. */
const proposalDigest = (id: string, paths: readonly string[]): string =>
  digest({ halt_reason: "completed", proposal_id: id, paths });

function signedGrant(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const g = {
    id: "grant-1",
    principal: "p",
    agent: "a",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: EXPIRES,
    ...over,
  };
  return { ...g, signature: signGrantPayload(canonicalGrantPayload(g), KEY) };
}

const grantOf = (over: Record<string, unknown> = {}): Grant =>
  signedGrant(over) as unknown as Grant;

const call = (
  over: Partial<{ name: string; result_digest: string; time: string }> = {},
): Record<string, unknown> => ({
  name: "hexagen_propose_patch",
  args_digest: "sha256:aa",
  result_digest: proposalDigest("p1", ["src/a.ts"]),
  time: CALL_TIME,
  ...over,
});

/** The line `hexagen_propose_patch` writes for a stored proposal. */
function proposeLine(
  id: string,
  paths: readonly string[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    grant_id: "grant-1",
    goal_id: "eng-1",
    tool_calls: [call({ result_digest: proposalDigest(id, paths) })],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: CALL_TIME,
    ended_at: CALL_TIME,
    ...over,
  };
}

async function appendLine(record: Record<string, unknown>): Promise<number> {
  const appended = await appendChainedLine(traceFile, (next) => ({
    ...record,
    ...next,
  }));
  return appended.seq;
}

async function writeMeta(
  id: string,
  over: Partial<{
    grantId: string;
    paths: string[];
    traceSeq: number | null;
  }> = {},
): Promise<void> {
  await put(
    root,
    `.hexagen/proposals/${id}.json`,
    JSON.stringify({
      id,
      grantId: "grant-1",
      sliceId: "eng-1",
      tool: "hexagen_propose_patch",
      paths: ["src/a.ts"],
      traceSeq: 0,
      createdAt: CALL_TIME,
      ...over,
    }),
  );
}

async function writeSlice(paths: string[] = ["src/"]): Promise<void> {
  await put(
    root,
    ".hexagen/slice.json",
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "eng-1",
      repo: { commit: git(root, "rev-parse", "HEAD") },
      paths,
      excludes: [],
      createdBy: "t@example.test",
      createdAt: CALL_TIME,
    }),
  );
}

function commit(message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

async function setup(): Promise<void> {
  root = await makeRepo(["src/a.ts", "src/b.ts", "lib/c.ts", "other/d.go"]);
  keyFile = path.join(root, "engagement.key");
  await writeFile(keyFile, `${KEY}\n`);
  traceFile = path.join(root, ".hexagen", "evidence", "trace.jsonl");
  grantFile = path.join(root, GRANT_REL);
  grant2File = path.join(root, GRANT2_REL);
}

/**
 * The common fixture: one covering line (seq 0) and its proposal committed at
 * `since`, so the range after it is judged with one old line plus whatever the
 * test appends next.
 */
async function setupWithOldLine(): Promise<void> {
  await setup();
  await writeSlice();
  await appendLine(proposeLine("p0", ["src/a.ts"]));
  await writeMeta("p0", { traceSeq: 0 });
  await put(root, GRANT_REL, JSON.stringify(signedGrant()));
  since = commit("base: slice, grant, one covering line");
}

const run = (
  over: Partial<Parameters<typeof runEvidenceVerify>[0]> = {},
): Promise<EvidenceVerifyResult> =>
  runEvidenceVerify({
    root,
    since,
    grantFiles: [grantFile],
    keyFile,
    ...over,
  });

const text = (r: EvidenceVerifyResult): string => r.messages.join("\n");

const pathsOf = (r: EvidenceVerifyResult): string[] | undefined =>
  r.unaccounted?.map((u) => u.path);

beforeEach(setupWithOldLine);
afterEach(cleanup);

/** Appends a line covering `paths`, and commits the change it accounts for. */
async function changeAndAccount(
  changes: Record<string, string>,
  id: string,
  paths: readonly string[],
  message = "change",
): Promise<void> {
  for (const [file, body] of Object.entries(changes)) {
    await put(root, file, body);
  }
  await appendLine(proposeLine(id, paths));
  await writeMeta(id, { paths: [...paths], traceSeq: 1 });
  commit(message);
}

describe("evidence verify, a covered change", () => {
  it("1. a changed in-slice file with a covering line passes", async () => {
    await changeAndAccount({ "src/a.ts": "changed\n" }, "p1", ["src/a.ts"]);
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(pathsOf(r) ?? []).toEqual([]);
    expect(r.covered).toEqual(["src/a.ts"]);
    expect(text(r)).toMatch(/evidence verify ok/);
  });

  it("judges the range up to --until, not HEAD", async () => {
    await changeAndAccount({ "src/a.ts": "changed\n" }, "p1", ["src/a.ts"]);
    const until = git(root, "rev-parse", "HEAD");
    await put(root, "src/b.ts", "later, unaccounted\n");
    commit("later");
    expect((await run({ until })).exitCode).toBe(0);
    expect((await run()).exitCode).toBe(1);
  });

  it("a squash-merged range is judged from the tree, not the graph", async () => {
    git(root, "checkout", "-q", "-b", "feature");
    await changeAndAccount(
      { "src/a.ts": "one\n" },
      "p1",
      ["src/a.ts"],
      "feature: change and account",
    );
    git(root, "checkout", "-q", "-");
    git(root, "merge", "-q", "--squash", "feature");
    commit("squash merge of feature");
    expect(git(root, "rev-list", "--count", `${since}..HEAD`)).toBe("1");
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.covered).toEqual(["src/a.ts"]);
  });

  it("a line appended after the fact still covers (it cannot tell when it was written)", async () => {
    // A hand edit that landed first, with an authorized line written after it.
    await put(root, "src/a.ts", "edited by hand\n");
    commit("hand edit, no trace line");
    expect((await run()).exitCode).toBe(1);
    const seq = await appendLine(proposeLine("p1", ["src/a.ts"]));
    await writeMeta("p1", { traceSeq: seq });
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.covered).toEqual(["src/a.ts"]);
  });
});

describe("evidence verify, an unaccounted change", () => {
  it("2. a changed in-slice file with no line exits 1 and is named", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
    expect(text(r)).toMatch(/unaccounted: src\/a\.ts/);
  });

  it("names every unaccounted file, with the nearest covering line", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    await put(root, "src/b.ts", "changed and accounted\n");
    await appendLine(proposeLine("p1", ["src/b.ts"]));
    await writeMeta("p1", { paths: ["src/b.ts"], traceSeq: 1 });
    commit("one accounted change, one silent");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
    expect(r.covered).toEqual(["src/b.ts"]);
    // The nearest line is the one appended in this range, which named src/b.ts.
    expect(r.unaccounted?.[0]?.nearestSeq).toBe(1);
    expect(r.unaccounted?.[0]?.nearestPaths).toEqual(["src/b.ts"]);
  });

  it("says so when no line was appended after --since at all", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(text(r)).toMatch(/no line was appended after --since at all/);
  });

  it("12. an old covering line does not cover a new change", async () => {
    await put(root, "src/a.ts", "changed after the fact\n");
    commit("the file changed again, unaccounted");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
    expect(r.candidateLines).toBe(0);
    // The line at seq 0 is still there, and still names src/a.ts.
    expect(
      (await readFile(traceFile, "utf8")).trimEnd().split("\n"),
    ).toHaveLength(1);
  });

  it("10a. a completed line whose proposal was never stored covers nothing", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    commit("change with a line whose proposal is absent");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });

  it("10b. the line hexagen_accept_transaction writes covers nothing", async () => {
    await setupWithOldLine();
    await put(root, "src/a.ts", "changed\n");
    // The accept writer names the pending mutation, not a path list, and leaves
    // no file under .hexagen/ holding one.
    await appendLine(
      proposeLine("p1", ["src/a.ts"], {
        tool_calls: [call({ name: "hexagen_accept_transaction" })],
      }),
    );
    commit("accept-path change");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });

  it("a proposal written while the trace was unchained covers nothing", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    await writeMeta("p1", { traceSeq: null });
    commit("change with a proposal whose traceSeq is null");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });

  it("a denial line covers nothing, even with a proposal that joins it", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(
      proposeLine("p1", ["src/a.ts"], { halt_reason: "grant_denied" }),
    );
    await writeMeta("p1", { paths: ["src/a.ts"], traceSeq: 1 });
    commit("change plus a denial line");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });
});

describe("evidence verify, scope", () => {
  it("3. a changed file outside the slice and grants is ignored", async () => {
    await put(root, "lib/c.ts", "changed\n");
    commit("outside the slice");
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.skipped).toBe(1);
    expect(text(r)).not.toContain("lib/c.ts");
  });

  it("8. reports a change outside every grant only as part of the skipped count", async () => {
    await put(root, "other/d.go", "changed\n");
    commit("outside everything");
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.skipped).toBe(1);
    expect(text(r)).toMatch(/skipped 1 change/);
    expect(text(r)).not.toContain("other/d.go");
    expect(pathsOf(r) ?? []).toEqual([]);
  });

  it("judges a changed file the slice does not name but a supplied grant does", async () => {
    await writeSlice(["src/"]);
    await put(
      root,
      GRANT2_REL,
      JSON.stringify(signedGrant({ id: "grant-2", paths: ["lib/"] })),
    );
    await put(root, "lib/c.ts", "changed\n");
    await appendLine(proposeLine("p1", ["lib/c.ts"], { grant_id: "grant-2" }));
    await writeMeta("p1", {
      grantId: "grant-2",
      paths: ["lib/c.ts"],
      traceSeq: 1,
    });
    commit("a grant-2 path outside the slice, accounted");
    const r = await run({ grantFiles: [grantFile, grant2File] });
    expect(r.exitCode).toBe(0);
    // The range also carries the grant, the slice, the line and the proposal,
    // none of which is in the slice or in a grant.
    expect(r.skipped).toBe(4);
    expect(r.covered).toEqual(["lib/c.ts"]);
    // Omitting grant-2 is not "out of scope, then": the line cites a grant that
    // no supplied file verifies, which is no known grant at all (Rule 3).
    const alone = await run();
    expect(alone.exitCode).toBe(2);
    expect(text(alone)).toMatch(/matches no known/);
  });

  it("skips the evidence files the range itself changed", async () => {
    await changeAndAccount({ "src/a.ts": "changed\n" }, "p1", ["src/a.ts"]);
    const r = await run();
    expect(r.exitCode).toBe(0);
    // .hexagen/evidence/trace.jsonl and .hexagen/proposals/p1.json are in the
    // range, and neither is inside the slice or a grant.
    expect(r.skipped).toBe(2);
  });
});

describe("evidence verify, tampering and forged evidence", () => {
  it("5a. a broken chain exits 2 before any coverage is judged", async () => {
    // Two lines, so editing the first one breaks `prev_hash` on the second.
    await changeAndAccount(
      { "src/b.ts": "accounted\n" },
      "p1",
      ["src/b.ts"],
      "an accounted change",
    );
    const lines = (await readFile(traceFile, "utf8")).trimEnd().split("\n");
    lines[0] = (lines[0] as string).replace(
      '"goal_id":"eng-1"',
      '"goal_id":"EDIT"',
    );
    await writeFile(traceFile, `${lines.join("\n")}\n`);
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/prev_hash does not match/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("5b. a proposal whose paths do not reproduce its line's result_digest exits 2", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    // The forgery: a path added to the metadata the digest was taken over. The
    // chain is intact; the join is not.
    await writeMeta("p1", { paths: ["src/a.ts", "src/b.ts"], traceSeq: 1 });
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/result_digest/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("never canonicalises the digest: the paths array order is the writer's", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(proposeLine("p1", ["src/a.ts", "src/b.ts"]));
    await writeMeta("p1", { paths: ["src/b.ts", "src/a.ts"], traceSeq: 1 });
    commit("a proposal whose paths were reordered after the line was written");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/result_digest/);
  });

  it("a proposal file that is not a proposal is bad state (2)", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    await put(root, ".hexagen/proposals/torn.json", "{ not json");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/torn\.json/);
    expect(r.unaccounted).toBeUndefined();
    await put(
      root,
      ".hexagen/proposals/torn.json",
      JSON.stringify({ id: "x" }),
    );
    const partial = await run();
    expect(partial.exitCode).toBe(2);
    expect(text(partial)).toMatch(/is not a proposal/);
  });

  it("14a. a proposal whose grantId differs from its line's grant_id covers nothing", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    await writeMeta("p1", { grantId: "grant-2", traceSeq: 1 });
    commit("change with a proposal written under another grant");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });

  it("14b. a file inside grant B's paths is not covered by a line written under grant A", async () => {
    await writeSlice(["src/", "lib/"]);
    await put(
      root,
      GRANT2_REL,
      JSON.stringify(signedGrant({ id: "grant-2", paths: ["lib/"] })),
    );
    await put(root, "lib/c.ts", "changed\n");
    await appendLine(proposeLine("p1", ["lib/c.ts"]));
    await writeMeta("p1", { paths: ["lib/c.ts"], traceSeq: 1 });
    commit("a lib change accounted under grant-1, which names src/ only");
    const r = await run({ grantFiles: [grantFile, grant2File] });
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["lib/c.ts"]);
    expect(r.skipped).toBe(4);
  });
});

describe("evidence verify, grant windows", () => {
  it("4. a call at or after its grant's revoked_at does not cover the file", async () => {
    await put(
      root,
      GRANT_REL,
      JSON.stringify(signedGrant({ revoked_at: CALL_TIME })),
    );
    await put(root, "src/a.ts", "changed\n");
    commit("change under a revoked grant");
    const r = await run();
    // Rule 2 makes the line invalid evidence, so the whole trace is refused
    // before any coverage is judged: nothing is covered and nothing is claimed.
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/revoked_at/);
    expect(r.unaccounted).toBeUndefined();
    expect(r.covered).toBeUndefined();
  });

  it("a call strictly after expires_at does not cover the file", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(
      proposeLine("p1", ["src/a.ts"], {
        started_at: EXPIRES,
        ended_at: "2026-12-01T00:00:01.000Z",
        tool_calls: [
          call({
            result_digest: proposalDigest("p1", ["src/a.ts"]),
            time: "2026-12-01T00:00:01.000Z",
          }),
        ],
      }),
    );
    await writeMeta("p1", { traceSeq: 1 });
    commit("change a millisecond after expiry");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/expires_at/);
  });

  it("the coverage predicate judges the window and the record itself (white box)", () => {
    // The whole-trace pass already refuses a line whose call is out of window,
    // so the coverage predicate is pinned here on its own: its own window check
    // and its own "the path and the time come from one record" rule.
    const candidate: CandidateLine = {
      seq: 4,
      grantId: "grant-1",
      paths: ["src/a.ts"],
      digest: proposalDigest("p1", ["src/a.ts"]),
      calls: [
        { result_digest: proposalDigest("p1", ["src/a.ts"]), time: CALL_TIME },
      ],
    };
    expect(coveringLine(candidate, grantOf(), "src/a.ts")).toBe(true);
    // Out of window at the call's own time.
    expect(
      coveringLine(candidate, grantOf({ revoked_at: CALL_TIME }), "src/a.ts"),
    ).toBe(false);
    expect(
      coveringLine(candidate, grantOf({ expires_at: CALL_TIME }), "src/a.ts"),
    ).toBe(true);
    // Outside the line's grant paths, or not named by its proposal: the two
    // scopes are separate, so each needs its own case.
    expect(coveringLine(candidate, grantOf(), "lib/c.ts")).toBe(false);
    expect(
      coveringLine(
        { ...candidate, paths: ["lib/c.ts"] },
        grantOf(),
        "lib/c.ts",
      ),
    ).toBe(false);
    expect(
      coveringLine(
        { ...candidate, paths: ["src/b.ts"] },
        grantOf(),
        "src/a.ts",
      ),
    ).toBe(false);
    // A call whose own time does not parse proves nothing.
    expect(
      coveringLine(
        {
          ...candidate,
          calls: [{ result_digest: candidate.digest, time: "yesterday" }],
        },
        grantOf(),
        "src/a.ts",
      ),
    ).toBe(false);
    // The path from one call, the time from another: no such cover.
    expect(
      coveringLine(
        {
          ...candidate,
          calls: [
            { result_digest: candidate.digest, time: AFTER_EXPIRES },
            {
              result_digest: proposalDigest("p2", ["src/b.ts"]),
              time: CALL_TIME,
            },
          ],
        },
        grantOf(),
        "src/a.ts",
      ),
    ).toBe(false);
    // The covering call is the one that names the file, not the first call.
    expect(
      coveringLine(
        {
          ...candidate,
          calls: [
            {
              result_digest: proposalDigest("p2", ["src/b.ts"]),
              time: CALL_TIME,
            },
            { result_digest: candidate.digest, time: CALL_TIME },
          ],
        },
        grantOf(),
        "src/a.ts",
      ),
    ).toBe(true);
  });
});

describe("evidence verify, two-call lines", () => {
  const two = (
    calls: readonly { result_digest: string; time: string }[],
  ): Record<string, unknown> => ({
    ...proposeLine("p1", ["src/a.ts"]),
    // The line's own window has to hold every call it carries (Rule 4), which
    // spans the grant's whole life here.
    started_at: "2026-09-01T00:00:00.000Z",
    ended_at: "2026-12-02T00:00:00.000Z",
    tool_calls: calls.map((c) => call(c)),
  });

  it("7. call A names the file but is out of window, call B is in window but names another file: no cover", async () => {
    // Hand-made: no writer emits more than one call per line.
    await put(root, "src/a.ts", "changed\n");
    await appendLine(
      two([
        {
          result_digest: proposalDigest("p1", ["src/a.ts"]),
          time: AFTER_EXPIRES,
        },
        { result_digest: proposalDigest("p2", ["src/b.ts"]), time: CALL_TIME },
      ]),
    );
    await writeMeta("p1", { paths: ["src/a.ts"], traceSeq: 1 });
    commit("a hand-made two-call line");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/after grant 'grant-1' expires_at/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("covers through the call that names the file, whichever call that is", async () => {
    await put(root, "src/a.ts", "changed\n");
    await appendLine(
      two([
        { result_digest: proposalDigest("p2", ["src/b.ts"]), time: CALL_TIME },
        { result_digest: proposalDigest("p1", ["src/a.ts"]), time: CALL_TIME },
      ]),
    );
    await writeMeta("p1", { paths: ["src/a.ts"], traceSeq: 1 });
    commit("a hand-made two-call line, covering call second");
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.covered).toEqual(["src/a.ts"]);
  });
});

describe("evidence verify, renames", () => {
  it("6a. a covered new path and an uncovered old path exits 1 naming the old path", async () => {
    git(root, "mv", "src/a.ts", "src/renamed.ts");
    await appendLine(proposeLine("p1", ["src/renamed.ts"]));
    await writeMeta("p1", { paths: ["src/renamed.ts"], traceSeq: 1 });
    commit("rename, accounted for the new path only");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/a.ts"]);
  });

  it("6b. the reverse case exits 1 naming the new path", async () => {
    git(root, "mv", "src/a.ts", "src/renamed.ts");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    await writeMeta("p1", { paths: ["src/a.ts"], traceSeq: 1 });
    commit("rename, accounted for the old path only");
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(pathsOf(r)).toEqual(["src/renamed.ts"]);
  });

  it("a rename with both sides covered passes", async () => {
    git(root, "mv", "src/a.ts", "src/renamed.ts");
    await appendLine(proposeLine("p1", ["src/a.ts", "src/renamed.ts"]));
    await writeMeta("p1", {
      paths: ["src/a.ts", "src/renamed.ts"],
      traceSeq: 1,
    });
    commit("rename, both sides accounted");
    expect((await run()).exitCode).toBe(0);
  });
});

describe("evidence verify, the range", () => {
  it("11a. an empty range exits 2 and says nothing was checked", async () => {
    const r = await run({ until: since });
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/empty diff: nothing was checked/);
  });

  it("11b. with --allow-empty it exits 0 and prints the same line", async () => {
    const r = await run({ until: since, allowEmpty: true });
    expect(r.exitCode).toBe(0);
    expect(text(r)).toMatch(/empty diff: nothing was checked/);
  });

  it("a non-empty range whose changes are all out of scope is not an empty diff", async () => {
    await put(root, "other/d.go", "changed\n");
    commit("out of scope");
    const r = await run();
    expect(r.exitCode).toBe(0);
    expect(r.skipped).toBe(1);
    expect(text(r)).not.toMatch(/empty diff/);
  });

  it("9. a shallow clone that cannot resolve <since> exits 2, never 0", async () => {
    await put(root, "src/a.ts", "changed\n");
    commit("a change in the full clone");
    const base = since;
    const holder = await mkdtemp(path.join(tmpdir(), "verify-shallow-"));
    dirs.push(holder);
    const target = path.join(holder, "clone");
    execFileSync("git", [
      "clone",
      "-q",
      "--depth",
      "1",
      `file://${root}`,
      target,
    ]);
    // The clone carries only the tip; `base` is its parent and is not here.
    const r = await runEvidenceVerify({
      root: target,
      since: base,
      grantFiles: [path.join(target, ".hexagen", "grants", "grant-1.json")],
      keyFile: path.join(target, "engagement.key"),
    });
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/shallow/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("13. a checkout where the trace was not tracked at <since> exits 2", async () => {
    await setup();
    await writeSlice();
    await put(root, GRANT_REL, JSON.stringify(signedGrant()));
    since = commit("base with no trace at all");
    await appendLine(proposeLine("p1", ["src/a.ts"]));
    await writeMeta("p1", { traceSeq: 0 });
    await put(root, "src/a.ts", "changed\n");
    commit("the trace is first committed alongside the change");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/not tracked at/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("an unresolvable <since> is exit 2, not a silent pass", async () => {
    const r = await run({ since: "no-such-ref" });
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/no-such-ref/);
  });
});

describe("evidence verify, preconditions", () => {
  it("a checkout with no staged .hexagen/ exits 2 naming the staging command", async () => {
    const bare = await mkdtemp(path.join(tmpdir(), "verify-bare-"));
    dirs.push(bare);
    git(bare, "init", "-q");
    await put(bare, "src/a.ts", "x\n");
    git(bare, "add", "-A");
    git(bare, "commit", "-q", "-m", "init");
    const r = await runEvidenceVerify({
      root: bare,
      since: git(bare, "rev-parse", "HEAD"),
      grantFiles: [path.join(bare, "grant.json")],
      keyFile: path.join(bare, "engagement.key"),
    });
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/hexagen workbook export --stage/);
    expect(r.unaccounted).toBeUndefined();
  });

  it("a missing trace file names the staging command, never a wall of unaccounted files", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    await writeFile(traceFile, "");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/hexagen workbook export --stage/);
    expect(pathsOf(r)).toBeUndefined();
  });

  it("a grant whose signature does not verify is bad input (2)", async () => {
    await put(root, "src/a.ts", "changed\n");
    commit("silent change");
    // Signed, then widened by hand: exactly what an agent editing its own grant
    // would produce, and what the key exists to refuse.
    const signed = signedGrant();
    await put(
      root,
      GRANT_REL,
      JSON.stringify({ ...signed, paths: ["src/", "lib/"] }),
    );
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/signature does not verify/);
  });

  it("a missing or unusable engagement key is bad input (2)", async () => {
    const named = await run({ keyFile: path.join(root, "nope.key") });
    expect(named.exitCode).toBe(2);
    expect(text(named)).toMatch(/no key file/);
    // No key location at all: no --key-file, no env, and a slice whose id cannot
    // name an engagement key file.
    const home = await mkdtemp(path.join(tmpdir(), "verify-home-"));
    dirs.push(home);
    await put(
      root,
      ".hexagen/slice.json",
      JSON.stringify({
        schemaVersion: "1.0.0",
        id: "eng/agement",
        repo: { commit: git(root, "rev-parse", "HEAD") },
        paths: ["src/"],
        excludes: [],
        createdBy: "t@example.test",
        createdAt: CALL_TIME,
      }),
    );
    const nowhere = await run({ keyFile: undefined, env: {}, homeDir: home });
    expect(nowhere.exitCode).toBe(2);
    expect(text(nowhere)).toMatch(/cannot locate the engagement key/);
  });

  it("an unreadable or malformed grant file is bad input (2)", async () => {
    expect(
      text(await run({ grantFiles: [path.join(root, "nope.json")] })),
    ).toMatch(/cannot read grant/);
    expect(
      (await run({ grantFiles: [path.join(root, "nope.json")] })).exitCode,
    ).toBe(2);
    await writeFile(grantFile, "not json");
    expect(text(await run())).toMatch(/not valid JSON/);
    expect((await run()).exitCode).toBe(2);
  });

  it("no --grant at all is refused", async () => {
    const r = await run({ grantFiles: [] });
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/--grant/);
  });

  it("a tip that anchors the head is checked, and an absent tip is not a failure", async () => {
    await changeAndAccount({ "src/a.ts": "changed\n" }, "p1", ["src/a.ts"]);
    expect((await run()).exitCode).toBe(0);
    const lines = (await readFile(traceFile, "utf8")).trimEnd().split("\n");
    const last = JSON.parse(lines[lines.length - 1] as string) as Record<
      string,
      unknown
    >;
    const hash = lineHash(last);
    await put(
      root,
      ".hexagen/evidence/tip.json",
      JSON.stringify({ seq: 1, hash, hmac: signTip(1, hash, KEY) }),
    );
    commit("anchor the head");
    expect((await run()).exitCode).toBe(0);

    await put(
      root,
      ".hexagen/evidence/tip.json",
      JSON.stringify({ seq: 1, hash, hmac: "0".repeat(64) }),
    );
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/tip\.json HMAC/);
  });

  it("a trace the tip does not anchor is exit 2", async () => {
    await changeAndAccount({ "src/a.ts": "changed\n" }, "p1", ["src/a.ts"]);
    await put(
      root,
      ".hexagen/evidence/tip.json",
      JSON.stringify({
        seq: 9,
        hash: "f".repeat(64),
        hmac: signTip(9, "f".repeat(64), KEY),
      }),
    );
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(text(r)).toMatch(/ends before the recorded tip/);
  });
});

describe("evidence verify (CLI wiring)", () => {
  it("parses --since and --until and sets the exit code", async () => {
    await put(root, "src/a.ts", "changed with no line\n");
    commit("silent change");
    const { evidenceCommander } =
      await import("../../../src/commands/evidence/index.js");
    const saved = process.exitCode;
    try {
      await evidenceCommander.parseAsync(
        [
          "verify",
          "--since",
          since,
          "--until",
          git(root, "rev-parse", "HEAD"),
          "--grant",
          grantFile,
          "--root",
          root,
          "--key-file",
          keyFile,
        ],
        { from: "user" },
      );
      expect(process.exitCode ?? 0).toBe(1);
    } finally {
      process.exitCode = saved;
    }
  });
});
