# Kit plan 1: unaccounted-mutation check

**Date:** 2026-10-03
**Status:** plan, not started. Checked against `origin/main` at `951acf1d`.
**Kernel object written:** Trace (new optional field on a line) and a reader over Transaction/Trace. Reads Grant.
**Type of output:** command spec and acceptance tests. No code until the owner asks.

## 1. Goal

A change to a file the kit governs with no matching Trace line is a defect, found in CI, for humans and agents alike. "Governs" means a file inside the slice (minus its excludes) or inside any supplied grant's `paths`. A change outside both is intentionally not judged: the kit has no say there, and the command prints how many such files it skipped so the scope is visible. This is the "mutation with no Transaction line is a defect" rule, enforced after the fact, because no write-time adapter exists for editors, shells or hand edits.

## 2. What is on main (verified)

- `docs/kernel/GRANT.md` "Known holes" and `docs/kernel/TRACE.md` "Known holes" state the gap: an editor or shell write never becomes a `PendingManifestMutation`, so it has no Transaction and no valid Trace.
- `hexagen evidence pack` (`packages/sync/src/commands/evidence/pack.ts`) verifies a trace file. It never looks at the repo's changes.
- `slice check` reports files changed since `repo.commit` under the slice (`packages/sync/src/commands/slice/index.ts`). It does not know about the trace.
- No command diffs git changes against trace lines. `grep -rniE "unaccounted|untraced" packages/sync/src packages/shared/src docs/kernel` returns nothing.
- A Trace line holds `args_digest` and `result_digest`, not paths (`docs/kernel/TRACE.md` "Schema"). A reader cannot say which files a line covers.

## 3. The gap

Two things are missing: a way for a line to say which paths it covers, and a reader that compares a git range to those lines.

## 4. Decision for the owner (blocks the plan)

The owner asked that Grant and Trace not be redesigned without being asked. Mapping files to lines needs one of:

<!-- plan-review: decisions -->

| Option          | Change                                                                                                                      | Cost                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A (recommended) | Add optional `paths: string[]` to each `tool_calls[]` record, inside the hash chain                                         | One additive Trace field. Older lines without it cover nothing.                |
| B               | Match by commit: a line carries `commit` (the commit its changes landed in)                                                 | Needs the agent to know the commit before it exists. Weak for squash merges.   |
| C               | No schema change: fail any change under granted paths unless `.hexagen/evidence/trace.jsonl` also changed in the same range | Cheap, and only proves a trace line was appended, not that it covers the file. |

The plan assumes A. C is a usable first slice if A is refused.

## 5. Command spec

```
hexagen evidence verify --since <git-ref> [--until <git-ref>]
                        --grant <file>... [--root <dir>]
                        [--key-file <path>] [--engagement <id>]
```

1. Resolve the changed files in `<since>..<until>` (default `HEAD`) with `git diff --name-status -M -z`, not `--name-only`, which prints one name per rename. Expand every `R` and `C` record into both its old and its new path, and judge each independently.
2. Keep the files inside the slice (minus excludes) or inside any supplied grant's `paths`. Count the rest as skipped and print the count.
3. Verify the trace as `evidence pack` does (chain, tip, rules), without writing a bundle.
4. For each kept file, find one `tool_calls[]` record, in a `completed` line, whose own `paths` include the file and whose own `time` falls inside that line's grant window. The path and the time are always read from the same record, never one from a record and one from another in the same line. A line with several calls covers a file only through the call that names it. Only mutation calls need to carry `paths`; a read-only call may omit it. No such record: the file is unaccounted.
5. Exit 0 if none are unaccounted. Exit 1 and print each unaccounted file with the nearest candidate line, if any. Exit 2 for bad input, a bad trace, or a shallow clone that cannot resolve `<since>`.

It reads only. It never writes `.hexagen/`.

## 6. Scope

In: the command, the optional `paths` field in `docs/kernel/trace.schema.json` and `TRACE.md`, a CI recipe, and wiring `paths` into the MCP propose tool's trace line (`hexagen_propose_patch`).
Out: write-time enforcement, an editor or shell adapter, any UI, any change to Grant.

## 7. Acceptance tests (written first, in `packages/sync/__tests__/`)

1. A changed in-slice file with a covering line passes.
2. A changed in-slice file with no line exits 1 and is named.
3. A changed file outside the slice and grants is ignored.
4. A call whose `time` is at or after its grant's `revoked_at` does not cover the file.
5. A broken chain or a tampered `paths` entry exits 2 before any coverage is judged.
6. A rename with a covered new path and an uncovered old path exits 1 naming the old path; the reverse case exits 1 naming the new path.
7. A completed line with two calls, where call A names the file but sits outside the window and call B is inside the window but names a different file, does not cover the file.
8. A change outside the slice and every grant is reported only as part of the skipped count.
9. A shallow clone with an unresolvable `<since>` exits 2, never 0.
10. A trace line from before the field existed covers nothing.

## 8. Risks

- Coverage is only as good as the agent honestly reporting `paths`. The check proves an authorized line exists, not that the line is true. Say so in the docs; do not call it verification of the agent.
- A human edit that also appends a forged line needs the engagement key, so the HMAC tip is the only barrier. The key is in the repo in repo mode. Keep the wording "refuses a tampered blob".
- It does not stop a write. It finds one afterward.

## 9. Liveness proof (AGENTS.md Step Zero)

The PR body must show: the command, a CI job that runs it on a fixture repo, and the failing run for the unaccounted-file test.

## 10. Order

First of the six. Items 5 and 6 depend on it for the CI recipe and the timeline rule. Item 3 does not.
