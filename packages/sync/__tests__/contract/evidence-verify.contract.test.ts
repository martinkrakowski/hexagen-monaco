/**
 * `hexagen evidence verify` against the BUILT artifact, in the published
 * layout — the liveness proof for the subcommand (kit plan 1 §9). The
 * in-process suite (`../commands/evidence/verify.test.ts`) proves the rules;
 * this one proves the binary a consumer actually installs parses
 * `evidence verify`, reaches the trace, and chooses the exit code the plan
 * fixes. Like its sibling it needs `yarn turbo build --filter=@hexagen/sync`
 * first, which is why it lives under `__tests__/contract/`.
 *
 * The fixture is a git repo with the `.hexagen/` evidence committed, which is
 * the staging precondition the command names: `hexagen workbook export
 * --stage` puts those files in the checkout, and a checkout without them exits
 * 2 rather than calling every changed file unaccounted.
 */
import assert from "node:assert/strict";
import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  appendChainedLine,
  lineHash,
  signTip,
} from "@hexagen/shared/node/trace-chain";
import {
  assertBuiltArtifactsPresent,
  cleanupFixture,
  createPublishedLayoutFixture,
  describeResult,
  runHexagen,
  VALID_MANIFEST,
  type ContractFixture,
} from "../helpers/published-layout.js";
import { canonicalGrantPayload } from "../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../src/commands/grant/sign.js";

const KEY = "ab".repeat(32);
const CALL_TIME = "2026-10-01T10:00:00.000Z";
const EXPIRES = "2026-12-01T00:00:00.000Z";

const git = (root: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd: root, encoding: "utf8" },
  ).trim();

const proposalDigest = (id: string, paths: readonly string[]): string =>
  `sha256:${createHash("sha256")
    .update(
      JSON.stringify({ halt_reason: "completed", proposal_id: id, paths }),
    )
    .digest("hex")}`;

function signedGrant(): string {
  const grant = {
    id: "grant-1",
    principal: "p",
    agent: "a",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: EXPIRES,
  };
  return JSON.stringify({
    ...grant,
    signature: signGrantPayload(canonicalGrantPayload(grant), KEY),
  });
}

let fix: ContractFixture;
let keyFile: string;
let grantFile: string;
let traceFile: string;
let since: string;
/** The base commit every test starts from; the per-test hook restores it. */
let pristine: string;

const put = async (rel: string, text: string): Promise<void> => {
  const file = path.join(fix.root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
};

const commit = (message: string): string => {
  git(fix.root, "add", "-A");
  git(fix.root, "commit", "-q", "-m", message);
  return git(fix.root, "rev-parse", "HEAD");
};

function proposeLine(
  id: string,
  paths: readonly string[],
): Record<string, unknown> {
  return {
    grant_id: "grant-1",
    goal_id: "eng-1",
    tool_calls: [
      {
        name: "hexagen_propose_patch",
        args_digest: "sha256:aa",
        result_digest: proposalDigest(id, paths),
        time: CALL_TIME,
      },
    ],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: CALL_TIME,
    ended_at: CALL_TIME,
  };
}

/**
 * One fixture for the whole suite, built once: `createPublishedLayoutFixture`
 * copies the built `dist` (megabytes, thousands of files) and links its
 * externals, which is far too much work to repeat per test — on a Windows CI
 * leg it blew the 30 s hook timeout before the first assertion ran. Nothing a
 * test writes is invisible to `git reset --hard`: every artefact is committed,
 * and the two tests that remove evidence use `git rm`, so restoring the base
 * commit restores the working tree too. The per-test hook is therefore a reset,
 * not a rebuild.
 */
beforeAll(async () => {
  await assertBuiltArtifactsPresent();
  fix = await createPublishedLayoutFixture(
    VALID_MANIFEST,
    "hexagen-verify-contract-",
  );
  keyFile = path.join(fix.root, "engagement.key");
  grantFile = path.join(fix.root, ".hexagen", "grants", "grant-1.json");
  traceFile = path.join(fix.root, ".hexagen", "evidence", "trace.jsonl");
  git(fix.root, "init", "-q");
  // The consumer copy of dist is fixture, not evidence: keeping it out of the
  // tree keeps every `git add -A` in this file off thousands of bundled files.
  await put(".gitignore", "node_modules/\n");
  await fs.writeFile(keyFile, `${KEY}\n`, "utf8");
  await put("src/a.ts", "const a = 1;\n");
  await put(
    ".hexagen/slice.json",
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "eng-1",
      repo: { commit: "0".repeat(40) },
      paths: ["src/"],
      excludes: [],
      createdBy: "t@example.test",
      createdAt: CALL_TIME,
    }),
  );
  await put(".hexagen/grants/grant-1.json", signedGrant());
  await appendChainedLine(traceFile, (next) => ({
    ...proposeLine("p0", ["src/a.ts"]),
    ...next,
  }));
  await put(
    ".hexagen/proposals/p0.json",
    JSON.stringify({
      id: "p0",
      grantId: "grant-1",
      sliceId: "eng-1",
      tool: "hexagen_propose_patch",
      paths: ["src/a.ts"],
      traceSeq: 0,
      createdAt: CALL_TIME,
    }),
  );
  // The pack step: only a line an anchored tip covers can cover a change.
  await anchorHead("base: evidence staged at last");
  since = git(fix.root, "rev-parse", "HEAD");
  pristine = since;
}, 180_000);

beforeEach(() => {
  // Only the git state a test changed: the index, the working tree and any file
  // it left untracked. The fixture itself — the copied dist and its symlinks —
  // is ignored, so it is never cleaned and never re-copied.
  git(fix.root, "reset", "--hard", "-q", pristine);
  git(fix.root, "clean", "-fdq");
});

/** Appends a chained line and its proposal, and returns the new seq. */
async function accountFor(paths: readonly string[]): Promise<number> {
  await appendChainedLine(traceFile, (next) => ({
    ...proposeLine("p1", paths),
    ...next,
  }));
  await put(
    ".hexagen/proposals/p1.json",
    JSON.stringify({
      id: "p1",
      grantId: "grant-1",
      sliceId: "eng-1",
      tool: "hexagen_propose_patch",
      paths,
      traceSeq: 1,
      createdAt: CALL_TIME,
    }),
  );
  return 1;
}

/** The pack step for the current head: anchor it and commit the tip. */
async function anchorHead(message: string): Promise<void> {
  const raw = await fs.readFile(traceFile, "utf8");
  const lines = raw.trimEnd().split("\n");
  const seq = lines.length - 1;
  const hash = lineHash(
    JSON.parse(lines[seq] as string) as Record<string, unknown>,
  );
  await put(
    ".hexagen/evidence/tip.json",
    JSON.stringify({ seq, hash, hmac: signTip(seq, hash, KEY) }),
  );
  commit(message);
}

afterAll(async () => {
  await cleanupFixture(fix.root);
});

const verify = (extra: string[] = [], grant = grantFile) =>
  runHexagen(fix, [
    "evidence",
    "verify",
    "--since",
    since,
    "--grant",
    grant,
    "--key-file",
    keyFile,
    ...extra,
  ]);

describe("hexagen evidence verify (built dist, published layout)", () => {
  it("exits 1 and names an in-slice change with no covering line", async () => {
    await put("src/a.ts", "const a = 2;\n");
    commit("hand edit, no trace line");
    const r = await verify();
    assert.equal(r.code, 1, describeResult(r));
    assert.match(r.stdout, /^src\/a\.ts$/m, describeResult(r));
    assert.match(r.stderr, /found after the fact/, describeResult(r));
    assert.match(r.stderr, /unaccounted: src\/a\.ts/, describeResult(r));
  });

  it("exits 0 when a line appended after --since covers the change", async () => {
    await put("src/a.ts", "const a = 2;\n");
    await accountFor(["src/a.ts"]);
    commit("change, accounted");
    await anchorHead("pack: anchor the head");
    const r = await verify();
    assert.equal(r.code, 0, describeResult(r));
    assert.match(r.stderr, /evidence verify ok/, describeResult(r));
  });

  it("exits 1 while the covering line is not anchored by a pack", async () => {
    await put("src/a.ts", "const a = 2;\n");
    await accountFor(["src/a.ts"]);
    commit("change, accounted but not yet packed");
    const r = await verify();
    assert.equal(r.code, 1, describeResult(r));
    assert.match(
      r.stderr,
      /cover exists but is not anchored: run hexagen evidence pack/,
      describeResult(r),
    );
  });

  it("exits 2 on an unsound trace, naming the line that fails", async () => {
    await put("src/a.ts", "const a = 2;\n");
    await accountFor(["src/a.ts"]);
    commit("change, accounted");
    await anchorHead("pack: anchor the head");
    // Edit the first line in place: the second line's prev_hash no longer
    // matches, so the chain says nothing about the range.
    const raw = await fs.readFile(traceFile, "utf8");
    const lines = raw.trimEnd().split("\n");
    lines[0] = (lines[0] as string).replace(
      '"goal_id":"eng-1"',
      '"goal_id":"EDIT"',
    );
    await fs.writeFile(traceFile, `${lines.join("\n")}\n`, "utf8");
    commit("an interior line edited in place");
    const r = await verify();
    assert.equal(r.code, 2, describeResult(r));
    assert.match(r.stderr, /prev_hash does not match/, describeResult(r));
  });

  it("exits 2 naming the staging command when .hexagen/ is not in the tree", async () => {
    await put("src/a.ts", "const a = 2;\n");
    // A grant outside `.hexagen/`, so the run reaches the evidence checks
    // instead of stopping on a missing grant file: this is the CI shape, where
    // the client never staged the kit and the checkout holds no evidence.
    await fs.copyFile(grantFile, path.join(fix.root, "grant-1.json"));
    commit("a grant kept outside the sidecar");
    git(fix.root, "rm", "-q", "-r", "--cached", ".hexagen");
    await fs.rm(path.join(fix.root, ".hexagen"), {
      recursive: true,
      force: true,
    });
    commit("evidence unstaged from the tree");
    const r = await verify([], "grant-1.json");
    assert.equal(r.code, 2, describeResult(r));
    assert.match(
      r.stderr,
      /hexagen workbook export --stage/,
      describeResult(r),
    );
  });

  it("exits 2 naming the packing command when no tip anchors the evidence", async () => {
    await put("src/a.ts", "const a = 2;\n");
    await accountFor(["src/a.ts"]);
    commit("change, accounted");
    git(fix.root, "rm", "-q", ".hexagen/evidence/tip.json");
    await fs.rm(path.join(fix.root, ".hexagen", "evidence", "tip.json"), {
      force: true,
    });
    commit("tip removed");
    const r = await verify();
    assert.equal(r.code, 2, describeResult(r));
    assert.match(r.stderr, /hexagen evidence pack/, describeResult(r));
  });

  it("exits 2 on an empty range, and 0 with --allow-empty", async () => {
    const r = await verify(["--until", since]);
    assert.equal(r.code, 2, describeResult(r));
    assert.match(
      r.stderr,
      /empty diff: nothing was checked/,
      describeResult(r),
    );
    const allowed = await verify(["--until", since, "--allow-empty"]);
    assert.equal(allowed.code, 0, describeResult(allowed));
    assert.match(
      allowed.stderr,
      /empty diff: nothing was checked/,
      describeResult(allowed),
    );
  });
});
