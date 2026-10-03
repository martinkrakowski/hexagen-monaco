# Kit plan 6: trace timeline rule and the two small items

**Date:** 2026-10-03
**Status:** plan. Checked against `origin/main` at `951acf1d`. Part A is a real gap; part B is already addressed and needs a doc fix.
**Kernel object written:** Trace (a reader rule; no new field).
**Type of output:** rule spec and acceptance tests.

## 1. Goal

A Trace line whose own timestamps contradict each other is invalid evidence, and every reader of the file says so the same way.

## 2. Part A: the timeline check

### What is on main (verified)

- `traceRuleReasons` in `packages/shared/src/types/trace-rules.ts` is the one function both the MCP server's `checkTrace` and `hexagen evidence pack` call. It checks grant presence (Rule 3), the tool allowlist, and each call's `time` against `revoked_at` and `expires_at`. It never reads `started_at` or `ended_at`.
- `evidenceShapeReasons` in `packages/sync/src/commands/evidence/check.ts` (line 94) only requires `started_at` and `ended_at` to parse as ISO timestamps.
- `docs/kernel/TRACE.md` says `tool_calls` are "in the order it made them" and defines `started_at` and `ended_at`, but states no rule tying them together.
- Current writers set `started_at` and `ended_at` to the same `time` (`accept-transaction-tool.use-case.ts` lines 282 and 283; `propose-patch-tool.use-case.ts` lines 210, 211, 274, 275, 309, 310). Confirm during implementation that each line's single call also carries that same value; if it does not, the new rule would reject lines the repo writes today.

### The rule

For every `completed` line, the reasons list gains:

1. `ended_at` is before `started_at`.
2. A call's `time` is before `started_at` or after `ended_at`.
3. Calls are out of order (a later call has an earlier `time`). Equal times are allowed.

Denial lines keep the existing exemption from the allowlist and window checks. They still need valid ISO timestamps, which `evidenceShapeReasons` already checks.

Put the rule in `traceRuleReasons` so the pack, the MCP reader and the future `evidence verify` (plan 1) cannot drift. Do not add a second implementation in `packages/sync`.

### Decision for the owner

This changes what counts as valid evidence for traces already written. A trace written before the rule, with a call time a millisecond outside its window because of two separate clock reads, would fail. Options: enforce now (recommended; current writers use one value), or enforce only for lines with a `seq` above a recorded cutover. The plan assumes enforce now.

### Acceptance tests (in `packages/shared/__tests__/` and the pack tests)

1. A line with `started_at <= call.time <= ended_at` and ordered calls is valid.
2. `ended_at` before `started_at` is invalid.
3. A call before `started_at` is invalid; a call after `ended_at` is invalid; a call exactly at either bound is valid.
4. Two calls out of order are invalid; two calls at the same instant are valid.
5. A denial line is not rejected for timeline reasons the allowlist exemption would have covered (its call may be outside the grant window), but a malformed timestamp still is.
6. Every line the current `accept` and `propose_patch` tests write is still valid under the new rule.
7. `evidence pack` and `checkTrace` return the same reasons for the same line.

## 3. Part B: a usable grant for a client repo with no manifest

My thread list included this as an open boundary from PR #711. It is no longer open in the way I described:

- `hexagen grant check` has a Field Kit form for client repos and denies paths outside the slice (`packages/sync/README.md`).
- `hexagen_propose_patch` is a propose-only tool that checks the grant and the slice and writes one trace line (`packages/mcp-server/src/application/use-cases/propose-patch-tool.use-case.ts`).
- What still holds: a paths-only grant cannot authorize the seven manifest mutation tools, because `checkMutationAgainstGrant` requires matching `contexts` (`packages/sync/README.md` under `grant issue`). That is correct for a client repo, which has no manifest to mutate.

So the work is a documentation change: the README line that says a paths-only grant is "scoped only for a future, generic Field Kit adapter" should name `hexagen_propose_patch` as that adapter for patches, and say plainly that editor and shell writes are still not enforced (`docs/kernel/GRANT.md` "Known holes"). No code.

## 4. Scope

In: the timeline rule and tests; the README and `GRANT.md` sentence fixes.
Out: any new Trace field, changing the chain format, the editor or shell adapter.

## 5. Risks

- A rule that rejects existing traces silently changes what `evidence pack` accepts. Mitigated by test 6 and the cutover decision.
- Clock skew across machines is not handled; the rule compares timestamps inside one line, written by one process, which is why it is safe to be strict.

## 6. Liveness proof (Step Zero)

The PR body shows the shared function's test run, and `hexagen evidence pack` rejecting a fixture trace with an out-of-window call.

## 7. Order

Part A is small and independent; do it with or before plan 1 so `evidence verify` inherits it. Part B can ride in any docs commit.
