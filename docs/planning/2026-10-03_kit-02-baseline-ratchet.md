# Kit plan 2: baseline and ratchet for a client repo

**Date:** 2026-10-03
**Status:** plan, mostly shipped. Checked against `origin/main` at `951acf1d`. What remains is a gap audit and one guard.
**Kernel object written:** Manifest side of the contract (`.hexagen/contract.json`, `knownViolations`). Writes no Grant or Trace.
**Type of output:** audit, command spec for the missing guard, acceptance tests.

## 1. Goal

On a repo the FDE does not control, the gate must not fail on day one, and it must not let the pile of known violations grow quietly. Existing debt is recorded once; only new violations fail; the record can shrink but not grow without review.

## 2. What is on main (verified)

The proposal I made in the thread ("`scan` snapshots violations, gate fails on new ones") described something that already exists in two places:

- `hexagen contract check --baseline --yes` writes today's failing violations to `knownViolations` in `.hexagen/contract.json`. Without `--baseline`, any violation not in the baseline names its rule, file and specifier and exits 1. Entries match on rule, file and specifier; an `expires` date (YYYY-MM-DD, inclusive to the end of that UTC day) stops hiding its violation. Source: `packages/sync/README.md` "`hexagen slice` and `hexagen contract`", `packages/shared/src/types/brownfield/contract-eval.ts`.
- `hexagen-lint --baseline <path>` and `--update-baseline`, with a ratchet (`tools/arch-linter/src/cli.ts`, `tools/arch-linter/src/ratchet-baseline.ts`). The PR-diff mode reports `introduced` and `baselineGrowth` (`cli.ts` around line 1155). The generated CI gate runs `hexagen-lint --ratchet` with a per-PR baseline diff (`packages/project-generation/src/domain/conformance-gate-files.ts`).
- `hexagen report` reads the baseline and draws a ratchet trend (`packages/sync/src/commands/report/baseline-read.ts`, `ratchet-trend.ts`).
- An unresolved import in the slice is a violation, not a skip, so a green result never means "the pass could not see the imports".

## 3. Gaps (to confirm before building)

1. **Growth guard for `contract.json`.** The arch-linter reports `baselineGrowth` against a PR base. I found nothing that does the same for `knownViolations` in `.hexagen/contract.json`. A PR can run `contract check --baseline --yes` and bury a new violation, and `contract check` then passes. This is the one real hole. Confirm by grep before building: `grep -rn "knownViolations" packages/sync/src packages/shared/src`.
2. **Entries with no `expires` and no `reason`.** The format allows them. A policy flag would warn on them.
3. **The generated CI gate does not run `contract check`.** `conformance-gate-files.ts` runs `hexagen-lint --ratchet` and `hexagen sync --check`, which need a manifest. A client repo with only `.hexagen/` has no gate job. Covered by plan 5's CI recipe, not here.

## 4. Command spec (gap 1 only)

```
hexagen contract check --base <git-ref> [--allow-growth --reason <text>]
```

- Reads `knownViolations` at `<git-ref>` and in the working tree.
- Exit 1 if the working tree holds any entry not present at the base, unless `--allow-growth` is given with a reason, which is printed in the output so the CI log carries it.
- An entry removed or with a later `expires` shortened passes. An entry with an `expires` pushed later counts as growth.
- A base with no `contract.json` treats the working-tree file as all growth, except on the first commit that adds the slice (a file absent at base and containing zero entries passes).
- Same exit codes as `contract check`: 0 clean, 1 growth or violation, 2 bad input (including an unresolvable ref in a shallow clone).

## 5. Scope

In: the `--base` guard, a warning for entries lacking `reason` or `expires`.
Out: changes to the arch-linter baseline, UI, a new baseline file format, auto-baselining on `scan`.

## 6. Acceptance tests

1. Adding a violation entry in a branch fails against the base.
2. Removing an entry passes.
3. Extending an entry's `expires` fails as growth.
4. `--allow-growth` without `--reason` exits 2.
5. An unresolvable base ref exits 2, never 0.
6. First-ever `contract.json` with zero entries passes.
7. A violation that is baselined at the base still passes `contract check` with no `--base`.

## 7. Risks

- A person with write access to the branch can pass `--allow-growth`. The reason lands in the CI log, which is the only check; say that plainly.
- The guard needs git history. Shallow CI clones must fetch the base. Fail with exit 2, not 0.

## 8. Liveness proof (Step Zero)

PR body shows: the command and its failing-run output on a fixture where an entry was added.

## 9. Order

After plan 1 only if sharing the git-range helper. Otherwise independent, and the smallest of the six.
