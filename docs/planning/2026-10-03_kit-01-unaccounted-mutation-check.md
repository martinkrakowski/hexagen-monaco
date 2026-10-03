# Kit plan 1: unaccounted-mutation check

**Date:** 2026-10-03
**Status:** plan, not started. Checked against `origin/main` at `951acf1d`; the owner decided §4 on 2026-10-02.
**Kernel object written:** none. Option D writes no Trace field and no Grant field; the command is a reader over Trace, the proposal metadata and Grant.
**Type of output:** command spec and acceptance tests. No code until the owner asks.

## 1. Goal

A change to a file the kit governs with no matching Trace line is a defect, found in CI, for humans and agents alike. "Governs" means a file inside the slice (minus its excludes) or inside any supplied grant's `paths`. A change outside both is intentionally not judged: the kit has no say there, and the command prints how many such files it skipped so the scope is visible. This is the "mutation with no Transaction line is a defect" rule, found after the fact, because no write-time adapter exists for editors, shells or hand edits.

## 2. What is on main (verified)

- `docs/kernel/GRANT.md` "Known holes" and `docs/kernel/TRACE.md` "Known holes" state the gap: an editor or shell write never becomes a `PendingManifestMutation`, so it has no Transaction and no valid Trace.
- `hexagen evidence pack` (`packages/sync/src/commands/evidence/pack.ts`) verifies a trace file. It never looks at the repo's changes.
- `slice check` reports files changed since `repo.commit` under the slice (`packages/sync/src/commands/slice/index.ts`). It does not know about the trace.
- No command diffs git changes against trace lines. `grep -rniE "unaccounted|untraced" packages/sync/src packages/shared/src docs/kernel` returns nothing.
- A Trace line holds `args_digest` and `result_digest`, not paths (`docs/kernel/TRACE.md` "Schema"), so a reader cannot say which files a line covers.
- The propose writer does leave a joinable record beside the line. `packages/mcp-server/src/application/use-cases/propose-patch-tool.use-case.ts:103` takes `paths` from the parsed patch, line 205 writes `result: { halt_reason: "completed", proposal_id: id, paths }` into the line's single `tool_calls[]` record, and lines 220-231 write the same `paths` and the line's `traceSeq` into `.hexagen/proposals/<id>.json` (`docs/kernel/proposal.schema.json` lines 13-14, 34, 49; the TS mirror is `packages/shared/src/types/brownfield/proposal.ts`). `packages/mcp-server/src/infrastructure/adapters/trace-write.adapter.ts:23-24,88` keeps only `result_digest = sha256(JSON.stringify(result))`, so the paths never reach `trace.jsonl` — but they are on disk beside it, and Option D reads them from there.
- The accept writer leaves nothing. `packages/mcp-server/src/application/use-cases/accept-transaction-tool.use-case.ts:251-267` names the call after the pending mutation, digests `pending.input` as `args` and the `AppliedMutation` (`{message, details}`, `pending-manifest-mutation.ts:40-43`) as `result`; `details` carries no paths, and no file under `.hexagen/` records them. A change applied through `hexagen_accept_transaction` has no recoverable path list, which is why Option A is a follow-on rather than the first slice.
- A writer emits exactly one call per line: `packages/mcp-server/src/infrastructure/adapters/trace-write.adapter.ts:84-91` builds `tool_calls` from the single `tool_call` on `TraceAppendInput` (`trace-write.port.ts:13-21`). No writer today can produce the two-call line test 7 needs, so that fixture is hand-made.

## 3. The gap

Two things are missing: a way to read back which paths a line covered, and a reader that compares a git range to those lines. Under Option D the first is a join to the proposal metadata the propose writer already writes (§2), not a new Trace field.

## 4. Decision for the owner

**Status: decided (owner, 2026-10-02).** Option D first, Option A later.

The owner asked that Grant and Trace not be redesigned without being asked. Mapping files to lines needs one of:

<!-- plan-review: decisions -->

| Option         | Change                                                                                                                      | Cost                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **D** (chosen) | No Trace field: read the paths back from `.hexagen/proposals/<id>.json` and join that file to its line by `traceSeq`        | No schema change and no writer change. Covers propose-driven changes only.                         |
| **A** (later)  | Add optional `paths: string[]` to each `tool_calls[]` record, inside the hash chain                                         | A schema change, plus a port and adapter change (§6). Kept for a writer with no joinable metadata. |
| **B**          | Match by commit: a line carries `commit` (the commit its changes landed in)                                                 | Needs the agent to know the commit before it exists. Weak for squash merges.                       |
| **C**          | No schema change: fail any change under granted paths unless `.hexagen/evidence/trace.jsonl` also changed in the same range | Cheap, and only proves a trace line was appended, not that it covers the file.                     |

Why D, and why first: the propose writer already records its paths and its line's `seq` beside the patch (§2), so the reader has something to join without asking anything of the writer; and D is verifiable rather than declarative — the verifier recomputes `result_digest` from the joined metadata, so a `paths` entry that was tampered with breaks the digest instead of being believed. A was costed above as one additive field, which is not what it is: `docs/kernel/trace.schema.json:46` sets `additionalProperties: false` on a `tool_calls[]` item, so A is a schema change plus `TraceWritePort` and `TraceWriteAdapter` (§6), and it lands when a second writer must be covered.

Rejected, one line each:

- **A** — right answer, wrong first slice: it needs a kernel schema change for a writer whose paths are already recoverable without one.
- **B** — the agent cannot know the commit before it exists, and the mapping is weak under squash merges.
- **C** — proves only that some line was appended in the range, so it can never name the file that is unaccounted.

## 5. Command spec

```
hexagen evidence verify --since <git-ref> [--until <git-ref>]
                        --grant <file>... [--root <dir>]
                        [--key-file <path>] [--engagement <id>]
                        [--allow-empty]
```

1. Resolve the changed files in `<since>..<until>` (default `HEAD`) with `git diff --name-status -M -z`, not `--name-only`, which prints one name per rename and loses which side moved. Extend `changedSince` in `packages/sync/src/commands/shared/brownfield-sidecar.ts:115-129` rather than writing a second diff helper: it already owns the NUL-splitting `gitZ` (line 71, module-private), so it takes the range and the `--name-status -M -z` form as a sibling of today's function and leaves the existing `--name-only` path byte-identical for its one caller (`slice/index.ts:176`). Expand every `R` and `C` record into both its old and its new path, and judge each independently.
2. Keep the files inside the slice (minus excludes) or inside any supplied grant's `paths`. Count the rest as skipped and print the count.
3. Verify the trace as `evidence pack` does, by calling what it calls and reimplementing nothing: `parseGrant` and `verifyGrantSignature` (`commands/grant/verify.ts:71,141`), `splitTrace`, `checkLines` (`commands/evidence/check.ts:140`) and `verifyTip`. An absent `tip.json` is not a failure here either (`evidence/pack.ts:246-254`). A missing trace file is exit 2, never exit 1: with no trace there is nothing to judge, and naming every file in the range unaccounted would be a false alarm (see the staging precondition, §11).
4. Pick the candidate lines, then judge each kept file against them.
   1. Only lines appended after `<since>` are candidates, or an old covering line covers a new change for good. A line qualifies when its `seq` is greater than the last `seq` in the trace as of `<since>` — on a sound chain `seq` is the line's 0-based position (`evidence/check.ts:62-66`) — read with `GitReader.show` (`commands/report/exec-git.ts:41-43`; the interface is `commands/report/types.ts:46-53`). When the trace was not tracked at `<since>` — `show` returns null — fall back to the `<since>` commit's committer time (`git show -s --format=%cI`, the same field `exec-git.ts:18-23` reads) and take the lines whose call `time` is after it.
   2. A candidate covers a file when its `halt_reason` is `completed` and it joins a proposal: some `.hexagen/proposals/<id>.json` whose `traceSeq` is the line's `seq`, and whose recomputed digest matches. Rebuild the result as `{ halt_reason, proposal_id, paths }` in that key order and take `sha256(JSON.stringify(...))`; the digest is over insertion order, not a sorted canonical form, so the same object re-serialised in another key order will not match and the reader must not canonicalise.
   3. `traceSeq: null` means the trace was unchained when the proposal was written, so there is no line to join and nothing is covered.
   4. The path and the time always come from the same record, never one from a record and one from another in the same line. A line with several calls covers a file only through the call that names it; no writer emits more than one call per line (§2), so that rule is proved by a hand-made fixture.
   5. Only mutation calls need to name their paths; a read-only call may omit them, and then it covers nothing. A call whose `time` is at or after the grant's `revoked_at`, or strictly after its `expires_at`, does not cover, judged by `checkGrantWindow(grant, new Date(call.time))` (`packages/shared/src/types/grant-checks.ts:58-93`) — the same function the accept path and `grant check` call, never a reimplementation.
   6. No such candidate: the file is unaccounted.
5. Count the raw changed paths from step 1 before any filtering. If that count is zero, exit 2 with "empty diff: nothing was checked", unless `--allow-empty` is given, in which case print the same line and exit 0. A non-empty diff whose paths are all outside the slice and grants is not empty: it follows the skipped-count behavior of step 2 and can exit 0. A clean result never means "nothing was looked at" by default.
6. Exit 0 if none are unaccounted. Exit 1 and print each unaccounted file with the nearest candidate line, if any. Exit 2 for bad input, a bad or absent trace, an empty diff without `--allow-empty`, or a shallow clone that cannot resolve `<since>`.

Squash merges and rebases need nothing here: the test is the age of the line, not the shape of the commit graph. Renames are expanded in step 1, and a shallow clone that cannot resolve `<since>` exits 2 rather than passing.

It reads only. It never writes `.hexagen/`.

## 6. Scope

In: the command; the extension of `changedSince`; a CI recipe; and one paragraph in `docs/kernel/TRACE.md`'s "Command spec", which today ends "Only this one subcommand is specified here" (line 316). For the Option A follow-on, and only then: `TraceWritePort` (`packages/mcp-server/src/application/ports/out/trace-write.port.ts:4-21`) and `TraceWriteAdapter` (`packages/mcp-server/src/infrastructure/adapters/trace-write.adapter.ts:77-119`), because the field has to travel from the use case's raw args through the port to the adapter that writes the record. Under Option D there is no change to `docs/kernel/trace.schema.json`, none to Grant, and none in the MCP server: the propose tool already writes the paths and the seq (§2). That follow-on is lane 1B, and it does not exist until the owner chooses A.
Out: write-time enforcement, an editor or shell adapter, any UI, any change to Grant.

## 7. Acceptance tests (written first, in `packages/sync/__tests__/`)

1. A changed in-slice file with a covering line passes.
2. A changed in-slice file with no line exits 1 and is named.
3. A changed file outside the slice and grants is ignored.
4. A call whose `time` is at or after its grant's `revoked_at` does not cover the file.
5. A broken chain, or a proposal whose `paths` do not reproduce its line's `result_digest`, exits 2 before any coverage is judged.
6. A rename with a covered new path and an uncovered old path exits 1 naming the old path; the reverse case exits 1 naming the new path.
7. A completed line with two calls, where call A names the file but sits outside the window and call B is inside the window but names a different file, does not cover the file. Hand-made fixture: no writer emits more than one call per line (§2).
8. A change outside the slice and every grant is reported only as part of the skipped count.
9. A shallow clone with an unresolvable `<since>` exits 2, never 0.
10. A `completed` line with no proposal to join covers nothing: a line from before proposals were recorded, and a line the accept path wrote, are both unaccounted.
11. `--since` and `--until` resolving to the same commit (an empty diff) exits 2 without `--allow-empty` and exits 0 with it, and both print that nothing was checked.
12. An old covering line does not cover a new change: a line whose `seq` is at or below the last `seq` in the trace at `<since>` never covers a file changed after `<since>`, even though the same line covers that file's earlier state.
13. The committer-time fallback, for a checkout where the trace was not tracked at `<since>`: a line whose call `time` is after that commit's committer time covers, and one before it does not.

## 8. Risks

- Coverage is only as good as the agent honestly reporting `paths`. The check proves an authorized line exists, not that the line is true. Say so in the docs; do not call it verification of the agent.
- A human edit that also appends a forged line needs the engagement key, so the HMAC tip is the only barrier. The key is in the repo in repo mode. Keep the wording "refuses a tampered blob".
- It does not stop a write. It finds one afterward. A line appended after the fact still covers: the check asks whether an authorized line was written after `<since>`, not whether it was written before the commit, so a forged one still needs the key.
- Until Option A lands, a change applied through `hexagen_accept_transaction` is unaccounted by this command, because that writer leaves no path list (§2). Say that in the docs; the check is narrower than "every change the kit governs".
- A checkout without the staging precondition (§11) has no trace at all. That is exit 2 with the staging line in the message, not a wall of unaccounted files.

## 9. Liveness proof (AGENTS.md Step Zero)

The PR body must show: the command, a CI job that runs it on a fixture repo, and the failing run for the unaccounted-file test. The suite that proves the shipped binary is `packages/sync/__tests__/contract/exit-codes.contract.test.ts`, which spawns the built `dist/cli.js` through `__tests__/helpers/published-layout.ts` (`runHexagen`, `assertBuiltArtifactsPresent`); a lane that adds a subcommand rebuilds the package before running it, or the suite says nothing about the new command.

## 10. Order

6A lands **before** this plan, not after it. 6A widens `TraceRuleLine` (`packages/shared/src/types/trace-rules.ts:16-23`) with `started_at`/`ended_at` and rewrites the fixtures in `packages/shared/__tests__/trace-rules.test.ts`; those two files are all it touches. This command reads its lines through the same `traceRuleReasons` (`packages/sync/src/commands/evidence/check.ts:131`), so it lands on the widened type rather than widening it a second time.

The order, wave by wave: 6A, 2A, 3A and 4A in parallel first; then 1A, 3B, 4B and 5A; then 1B, and only if the owner chooses Option A; then 5B. 6B goes whenever #751 is settled. 1A is this command under Option D; 1B is the Option A follow-on and does not exist unless A is chosen. 5A lands beside 1A rather than after it, so nothing here blocks it, and 5B waits on 1B, which may never happen. What this plan owes plan 5 is the staging precondition (§11) and the exit-code split — 1 for an unaccounted change, 2 for bad input or stale state.

## 11. Preconditions

Every writer of `.hexagen/` adds it to `.git/info/exclude`: `slice init` (`packages/sync/src/commands/slice/index.ts:112`), `contract add-rule` and `contract --baseline` (`contract/index.ts:98`), `observe` (`observe/index.ts:739`) and `grant issue` (`grant/issue.ts:384`) each call `ensureExcluded(root, ".hexagen/")`. A CI checkout therefore has no trace, no tip, no slice, no grants and no proposals until the client staged them, and this command cannot run without them. The precondition, named exactly:

```
hexagen workbook export --stage .hexagen/slice.json \
  .hexagen/evidence/trace.jsonl \
  .hexagen/evidence/tip.json \
  .hexagen/grants/<id>.json \
  .hexagen/proposals/<id>.json \
  --yes
```

Each path resolves against the repo root and must land under `.hexagen/` (`workbook/export.ts:660-669`) and be on the allow-list, which permits all of them (`workbook/allow-list.ts:19-28`); anything else is refused rather than read. `<id>` is every grant passed to `--grant` and every proposal the range has to join. `.hexagen/evidence/tip.json` is staged only when it exists, since an absent tip is not a failure (`evidence/pack.ts:246-254`).

## 12. Lanes

The order above is the review's; the tests are what each lane runs.

<!-- plan-review: lanes -->

| Lane   | Depends on                                       | Targeted tests                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **6A** | nothing; first of all, alone on `trace-rules.ts` | `packages/shared/__tests__/trace-rules.test.ts`; the writer suites `packages/mcp-server/__tests__/application/use-cases.test.ts`, `.../application/propose-patch.test.ts`, `.../infrastructure/adapters/trace-write.adapter.test.ts`                                         |
| **1A** | 6A                                               | new `packages/sync/__tests__/commands/evidence/verify.test.ts`; `packages/sync/__tests__/commands/slice/slice.test.ts` for the shared `changedSince`; `packages/sync/__tests__/contract/exit-codes.contract.test.ts` after `yarn turbo build --filter=@hexagen/sync --force` |
| **2A** | nothing; parallel with 6A, 3A, 4A                | its own suite under `packages/sync/__tests__/commands/contract/`                                                                                                                                                                                                             |
| **3A** | nothing; parallel with 6A, 2A, 4A                | its own suite under `packages/sync/__tests__/commands/contract/`                                                                                                                                                                                                             |
| **4A** | nothing; parallel with 6A, 2A, 3A                | its own suite under `packages/sync/__tests__/commands/grant/`                                                                                                                                                                                                                |
| **1B** | 1A, and only if Option A is chosen               | `packages/mcp-server/__tests__/infrastructure/adapters/trace-write.adapter.test.ts`, `.../application/propose-patch.test.ts`, then 1A's suite                                                                                                                                |
| **3B** | 3A                                               | `yarn workspace web test` and `yarn workspace web typecheck` — the viewer consumer is `apps/web/features/brownfield-workbook/middle/derive.ts:177`                                                                                                                           |
| **4B** | 4A                                               | its own suite under `packages/sync/__tests__/commands/grant/`; the exit-code contract, after a rebuild, if `grant list` lands in this half                                                                                                                                   |
| **5A** | nothing beyond what it shares with 1A            | its own suite under `packages/sync/__tests__/commands/evidence/`                                                                                                                                                                                                             |
| **5B** | 1B                                               | `packages/sync/__tests__/contract/exit-codes.contract.test.ts` with `__tests__/helpers/published-layout.ts` and `__tests__/helpers/stage-publish-package.ts`                                                                                                                 |
| **6B** | #751 settled                                     | the README and GRANT sentences carry no test of their own; the lane still runs `yarn build && yarn typecheck && yarn lint`                                                                                                                                                   |

Lane hygiene, from the review, for whoever dispatches these:

- `docs/kernel/TRACE.md` and `docs/kernel/trace.schema.json` are edited by this plan and by plan 6, so 1A and the plan-6 lane that amends either file must not run in parallel. 6A edits neither, so 6A and 1A do not collide.
- `packages/sync/README.md` is edited by plans 2 to 6 and not by this one: the README has no `hexagen evidence pack` section of its own (the only mentions are inside the workbook section, lines 451 to 458), so 1A leaves it alone and does not join that queue.
- Any lane that adds a CLI subcommand rebuilds `packages/sync` before `exit-codes.contract.test.ts`, and checks `public-surface.contract.test.ts` only if it touches a barrel. 1A adds a subcommand and touches no barrel: the root `src/index.ts` exports no command (lines 24 to 31), so `EXPECTED_PUBLIC_SURFACE` does not change.
