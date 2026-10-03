# Kit plan 6: trace timeline rule and the two small items

**Date:** 2026-10-03
**Status:** plan, revised after the six-plans review. Checked against `origin/main` at `951acf1d`. Part A is a real gap and is now decided; part B is already addressed, needs a doc fix only, and waits on PR #751.
**Kernel object written:** Trace (a reader rule; no new field).
**Type of output:** rule spec and acceptance tests.

## 1. Goal

A Trace line whose own timestamps contradict each other is invalid evidence, and every reader of the file says so the same way.

## 2. Part A: the timeline check

### What is on main (verified)

- `traceRuleReasons` in `packages/shared/src/types/trace-rules.ts:44` is the one implementation of the reader rules, and it has exactly two live callers: `hexagen evidence pack` (`packages/sync/src/commands/evidence/check.ts:131`, reached from `evidence/pack.ts:239`) and `hexagen workbook export`, which calls `runEvidencePack` (`packages/sync/src/commands/workbook/export.ts:423`). It checks grant presence (Rule 3), the tool allowlist, and each call's `time` against `revoked_at` and `expires_at`. It never reads `started_at` or `ended_at`. The MCP server's `checkTrace` (`packages/mcp-server/src/application/kernel/trace.ts:100`) is a one-line wrapper over it, and the only importer in the repo is its own test (`packages/mcp-server/__tests__/application/kernel/trace.test.ts:8`), so it is not a live reader. The copy in `docs/kernel/spike/trace.ts:63` is a separate reference implementation that no runner executes: each workspace's Vitest root is its own package directory (`vitest.shared.ts`), so nothing under `docs/` is collected.
- `TraceRuleLine` (`packages/shared/src/types/trace-rules.ts:16-23`) carries `grant_id`, `halt_reason` and `tool_calls` only, and the pack casts a raw parsed record into it (`check.ts:131`). A `started_at` or `ended_at` that is absent or unparsable is therefore ignored today. The type has to be widened before the rule can see them.
- `evidenceShapeReasons` in `packages/sync/src/commands/evidence/check.ts:89` (the `started_at`/`ended_at` pair is checked at lines 94-98) only requires them to parse as ISO timestamps. It is a separate step from the rules: `checkLines` calls `ruleReasons` only when the shape is clean (`check.ts:192-196`).
- `docs/kernel/TRACE.md` says `tool_calls` are "in the order it made them" (line 59) and gives `started_at` and `ended_at` nothing but "ISO 8601" (lines 67-69), so it states no rule tying them together. `docs/kernel/trace.schema.json` already states it in prose — `started_at` "should be at or before every tool_calls[].time and at or before ended_at" (line 88), `ended_at` the mirror (line 93) — but that file is JSON Schema draft-07, which cannot compare sibling values, so nothing checks it. This plan makes a reader check what the schema already says.
- Every writer is compatible with the rule, checked rather than assumed. Each `appendLine` site binds one timestamp and passes it as the call's `time`, `started_at` and `ended_at`: `accept-transaction-tool.use-case.ts:269` then `282-283`; `propose-patch-tool.use-case.ts:198` then `210-211`, `266` then `274-275`, `295` then `309-310`. `TraceWriteAdapter.appendLine` writes exactly one `tool_calls` entry and copies the three values through (`packages/mcp-server/src/infrastructure/adapters/trace-write.adapter.ts:81-96`), so every line the repo writes today satisfies the rule with `started_at == ended_at == call.time`. The existing fixtures agree: `trace-write.adapter.test.ts:44-45`, `trace-write.child.ts:37-38`, `apps/tui/__tests__/brownfield/harness.ts:128-129` (and its denial line at 154-155), `apps/web/features/brownfield-workbook/__tests__/right-fixtures.ts:37-38`, `packages/sync/__tests__/commands/evidence/pack.test.ts:82-83`, `packages/sync/__tests__/commands/workbook/export.test.ts:156-157`, `packages/shared/__tests__/brownfield/trace-schema.test.ts:31-32`, and the `checkTrace` fixture, whose window 09:59:00-10:00:05 contains its 10:00:00 call (`packages/mcp-server/__tests__/application/kernel/trace.test.ts:46-47`), denial cases included.
- The only fixtures that do not satisfy the rule are in `packages/shared/__tests__/trace-rules.test.ts`: the `line()` helper (lines 9-13) emits no `started_at`/`ended_at` at all, so every case there has to gain them.

### The rule

For every line that carries `tool_calls` — that is, every `completed`, `grant_denied`, `grant_expired`, `grant_revoked` and `error` line — the reasons list gains:

1. `ended_at` is before `started_at`.
2. A call's `time` is before `started_at` or after `ended_at`.
3. Calls are out of order (a later call has an earlier `time`). Equal times are allowed.
4. `started_at` or `ended_at` is missing or does not parse. A `completed` line without them is a reason, not a skip, and neither is a denial line's.
5. Not a new rule but a constraint on 3: a call whose `time` does not parse is already a reason (`trace-rules.ts:71-76`), and the order comparison skips it rather than comparing a null.

Denial lines get no exemption from these. The early return at `trace-rules.ts:53` keeps its present scope — the allowlist and the window checks — because a denial's tool or time being outside the _grant_ is exactly why it was refused. The new reasons compare timestamps inside one line, written by one process, and a grant window says nothing about them. They are therefore computed before that early return, not after it.

A `grant_missing` record is not an evidence line: it has a single `time`, no window and no `tool_calls`, and `checkLines` returns its verdict before `ruleReasons` is reached (`check.ts:163-190`). The rule does not touch it.

Put the rule in `traceRuleReasons`, so the pack, the export and the future `evidence verify` (plan 1) cannot drift. Leave `evidenceShapeReasons` the ISO check it already is. Do not add a second implementation in `packages/sync`.

Tightening the doc text belongs to this lane rather than to a follow-on: add the rule as Rule 4 to `docs/kernel/TRACE.md` "Rules" (line 119, alongside the three that are there), and turn "should be" into "must be" in the two `trace.schema.json` descriptions (lines 88 and 93). The "Denials" section (line 160) already scopes the skip to the allowlist and window checks, so it needs no change — that is the line the new rule is not covered by. Both files are shared with plan 1, so the edit is serialised — see §8.

### Decision for the owner

**Decided (owner, 2026-10-02): check from now on, and exempt nothing, denial lines included.**

The reason: every writer binds one timestamp and passes it as the call's `time`, `started_at` and `ended_at` (verified above), so no line this repo writes can fail the rule, and the failure the alternative guards against — two clock reads a millisecond apart — cannot occur while that holds. A writer that later diverges should fail loudly rather than be grandfathered.

Rejected alternatives, one line each:

- A recorded cutover `seq`, with the rule applying only above it: it needs a cutover value no artifact carries today, and buys nothing while every writer emits one value.
- Exempting denial lines: the comparison is internal to one line, so a denial's grant-window violation is irrelevant to it, and the exemption would leave the least trustworthy lines unchecked.
- Checking in `hexagen evidence pack` only: two implementations, the exact drift the shared function exists to prevent.

### Acceptance tests

Rules 1-5 in `packages/shared/__tests__/trace-rules.test.ts`, whose `line()` helper gains `started_at`/`ended_at`; the reader-parity test in the pack tests.

1. A line with `started_at <= call.time <= ended_at` and ordered calls is valid.
2. `ended_at` before `started_at` is invalid.
3. A call before `started_at` is invalid; a call after `ended_at` is invalid; a call exactly at either bound is valid.
4. Two calls out of order are invalid; two calls at the same instant are valid.
5. Split in two, because these are two rules: (a) a denial line whose call falls outside its own `started_at`/`ended_at` is invalid — the timeline rule has no exemption; (b) a denial line whose tool is outside `grant.tools` and whose call is after `expires_at` is still valid on those two counts, as long as its own window contains the call. (b) is already covered at `packages/mcp-server/__tests__/application/kernel/trace.test.ts:91-118` and must stay green.
6. A line missing `started_at` or `ended_at`, or carrying one that does not parse, is invalid — for a `completed` line and for a denial line.
7. Every line the current `accept` and `propose_patch` tests write is still valid under the new rule: `trace-write.adapter.test.ts`, `trace-write.child.ts`, `apps/tui/__tests__/brownfield/`, `apps/web/features/brownfield-workbook/__tests__/`, `evidence/pack.test.ts`, `workbook/export.test.ts` and `brownfield/trace-schema.test.ts` need no edit (checked above) and must stay green.
8. `hexagen evidence pack` and `hexagen workbook export` return the same reasons for the same line — the two live readers, both reached through `runEvidencePack` → `checkLines` → `traceRuleReasons`.

## 3. Part B: a usable grant for a client repo with no manifest

My thread list included this as an open boundary from PR #711. It is no longer open in the way I described:

- `hexagen grant check` has a Field Kit form for client repos and denies paths outside the slice (`packages/sync/README.md:169-174`).
- `hexagen_propose_patch` is a propose-only tool that checks the grant and the slice and writes one trace line (`packages/mcp-server/src/application/use-cases/propose-patch-tool.use-case.ts`).
- What still holds: a paths-only grant cannot authorize the seven manifest mutation tools, because `checkMutationAgainstGrant` denies unless `grant.contexts` names the mutation's context (`packages/mcp-server/src/application/kernel/grant.ts:178-184`, and `packages/sync/README.md:130-147` under `grant issue`). That is correct for a client repo, which has no manifest to mutate.

So the work is a documentation change, and no code:

- `packages/sync/README.md:145-147` — the sentence "it is scoped only for a future, generic Field Kit adapter that doesn't check `contexts`, not for `hexagen_accept_transaction` as it exists today" should name `hexagen_propose_patch` as that adapter for patches, and say that it is the adapter that exists today rather than a future one.
- `docs/kernel/GRANT.md`, "Known holes" (line 234) — the first bullet already says editor and shell writes are unmuzzled; the change is to name `hexagen_propose_patch` as the Field Kit adapter that does exist, so the hole is stated against a known adapter rather than in the abstract.

This is lane 6B, and it waits for PR #751 to be settled (owner, 2026-10-02): that PR is held open outside this sweep, and 6B is gated on it. No claim is made here about what #751 contains; the gate is its settlement, nothing more.

## 4. Scope

In: the timeline rule in `traceRuleReasons`; the widened `TraceRuleLine`; the shared rule fixtures; the rule text in `docs/kernel/TRACE.md` and `docs/kernel/trace.schema.json`; the README and `GRANT.md` sentence fixes.
Out: any new Trace field, changing the chain format, `grant_missing` records, the editor or shell adapter.

## 5. Risks

- A rule that rejects existing traces silently changes what `evidence pack` accepts. Mitigated by test 7, the fixture survey above, and the check-from-now-on decision: the writers bind one value, so no line written today can fail.
- Denial lines now carry a reason they never carried. Every denial path today binds its timestamp once (`propose-patch-tool.use-case.ts:266,295`; the accept denial that reaches `appendLine` reuses the same `now` at line 269, and the `appendGrantMissing` denial at line 260 is not an evidence line), so no denial the repo writes is affected either.
- Clock skew across machines is not handled; the rule compares timestamps inside one line, written by one process, which is why it is safe to be strict.
- Widening `TraceRuleLine` touches a shared type, but its only consumer is the pack's cast (`check.ts:131`), so the blast radius is one file.

## 6. Liveness proof (Step Zero)

The PR body carries the commands and their output, not the claim. At minimum: `yarn vitest run packages/shared/__tests__/trace-rules.test.ts` (the new reasons, failing before the change and passing after), `yarn workspace @hexagen/sync test` (the pack and export suites, which reach the rule through the two live readers), and one `hexagen evidence pack` run against a fixture trace whose call sits outside its own `started_at`/`ended_at`, exiting 1 with the new reason.

## 7. Order

6A is wave 1, in parallel with 2A, 3A and 4A, and therefore lands **before** plan 1 (whose 1A is wave 2) — not after it. 6B goes whenever #751 is settled, and needs nothing from 6A.

No `.hexagen/` staging precondition applies to this plan, unlike plans 1, 2 and 5: every test that reaches the rule builds its own root in a temp directory and writes the trace there (`evidence/pack.test.ts:51-52`; `workbook/export.test.ts` via `makeRepo`), so nothing depends on `.hexagen/` being tracked in the checkout. Checked, not assumed.

## 8. Lanes

**6A — the timeline rule.** No dependency: wave 1, in parallel with 2A, 3A and 4A, and ahead of plan 1's 1A. Files: `packages/shared/src/types/trace-rules.ts`, `packages/shared/__tests__/trace-rules.test.ts`, plus the doc text in `docs/kernel/TRACE.md` and `docs/kernel/trace.schema.json`. Serialisation: the review scopes 6A's code to `trace-rules.ts` and attributes `docs/kernel/TRACE.md` and `trace.schema.json` to "plans 1 and 6"; keeping that doc text in 6A is the conservative reading, and it is safe either way, because no lane may touch those three files in parallel and the wave order already puts 6A (wave 1) before plan 1's 1A (wave 2). It adds no CLI subcommand and touches no barrel, so the exit-codes and public-surface contract tests do not bind it.
Tests to run: `packages/shared/__tests__/trace-rules.test.ts`, `packages/shared/__tests__/brownfield/trace-schema.test.ts`, `packages/mcp-server/__tests__/application/kernel/trace.test.ts`, `packages/mcp-server/__tests__/infrastructure/adapters/trace-write.adapter.test.ts`, `packages/sync/__tests__/commands/evidence/pack.test.ts`, `packages/sync/__tests__/commands/workbook/export.test.ts`, `apps/tui/__tests__/brownfield/brownfield-view.test.tsx`, `apps/web/features/brownfield-workbook/__tests__/right-panel.derive.test.ts`. Then `yarn lint && yarn typecheck`.

**6B — the README and `GRANT.md` sentences.** Depends on PR #751 being settled, and on nothing from 6A. Files: `packages/sync/README.md:145-147` and `docs/kernel/GRANT.md` "Known holes". Serialisation: `packages/sync/README.md` is also edited by plans 2, 3, 4 and 5, so 6B cannot run in parallel with any of their README edits. Docs only, so no contract test needs a rebuild; no test in `packages/sync/__tests__/contract/` reads the README (checked).
Tests to run: `packages/sync/__tests__/commands/grant/build.test.ts` and `packages/sync/__tests__/commands/grant/show-check.test.ts`, the two suites that cover the behaviour the sentences describe. Then `yarn lint`.
