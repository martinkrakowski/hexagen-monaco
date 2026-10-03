# Kit plan 2: baseline and ratchet for a client repo

**Date:** 2026-10-03
**Status:** plan, mostly shipped. Checked against `origin/main` at `951acf1d`, then re-read against the six-plan review and the owner's decisions of 2026-10-02.
**Kernel object written:** Manifest side of the contract (`.hexagen/contract.json`, `knownViolations`). Writes no Grant or Trace.
**Type of output:** audit, command spec for the missing guard, acceptance tests.

## 1. Goal

On a repo the FDE does not control, the gate must not fail on day one, and it must not let the pile of known violations grow quietly. Existing debt is recorded once; only new violations fail; the record can shrink but not grow without review. Since the review, "not grow" covers the rule set and the slice excludes too, not only the baseline list.

## 2. What is on main (verified)

The proposal I made in the thread ("`scan` snapshots violations, gate fails on new ones") described something that already exists in two places:

- `hexagen contract check --baseline --yes` writes today's failing violations to `knownViolations` in `.hexagen/contract.json`. The write is the `--baseline` branch of the check command, `packages/sync/src/commands/contract/index.ts:253-295` (the file lands in `writeContract` at 286-292), not the shared evaluator. Without `--baseline`, any violation not in the baseline names its rule, file and specifier and exits 1 (301-330). Entries match on rule, file and specifier in `packages/shared/src/types/brownfield/contract-eval.ts` (`isKnown` at 123-129 over `findKnownViolation` at 108-119); an `expires` date (YYYY-MM-DD, inclusive to the end of that UTC day, `isSuppressionExpired` at 83-105) stops hiding its violation. Re-baselining **drops** an `expires` that has already passed, so the entry hides again (`contract/index.ts:274-280`). Command surface: `packages/sync/README.md:334` "`hexagen slice` and `hexagen contract`", the `contract check` bullet at 381.
- `hexagen-lint --baseline <path>` and `--update-baseline`, with a ratchet (`tools/arch-linter/src/cli.ts`, `tools/arch-linter/src/ratchet-baseline.ts`). The PR-diff mode reports `introduced` and `baselineGrowth` (`cli.ts` 1155, 1204-1205, 1271-1292). The generated CI gate runs `hexagen-lint --ratchet` with a per-PR baseline diff (`packages/project-generation/src/domain/conformance-gate-files.ts:103,125`).
- `hexagen report` reads **the arch-linter baseline**, `.architecture/arch-lint-baseline.json` (`report/baseline-read.ts`, `report/build-report.ts:18`, `report/ratchet-trend.ts:15`), and draws a ratchet trend from that file's git history. It never reads `.hexagen/contract.json`, and it needs a manifest (`report/index.ts:25-28`), so it does not run in a client repo that holds only `.hexagen/`.
- Every writer of `.hexagen/` adds it to the repo's exclude file, so a fresh clone tracks none of it: `ensureExcluded(root, ".hexagen/")` in `slice init` (`slice/index.ts:112`), `contract add-rule` and `contract --baseline` (`contract/index.ts:98`), `observe` (`observe/index.ts:739`) and `grant issue` (`grant/issue.ts:384`). The export allow-list does permit these files (`workbook/allow-list.ts:22-28`), so `hexagen workbook export --stage … --yes` (`git add -f`) is the supported way in. This is the precondition in §4.
- An unresolved import in the slice is a violation, not a skip, so a green result never means "the pass could not see the imports".

## 3. Gaps (to confirm before building)

1. **Growth guard for `contract.json`.** The arch-linter reports `baselineGrowth` against a PR base (`cli.ts:1271-1292`). Nothing does the same for `.hexagen/contract.json`. Re-ran the grep rather than trusting the first pass: `grep -rn "knownViolations" packages/sync/src packages/shared/src` returns 14 hits — the baseline write and read in `contract/index.ts:167,264,268,288,415`, the load-time date check in `shared/brownfield-sidecar.ts:222-230`, the schema in `shared/…/contract.ts:6,61,72` and the matchers in `shared/…/contract-eval.ts:109,112,113,124`. None of them names a git ref. The bypasses are why this is the one real hole, and each is reachable without `--allow-growth`:
   - delete or widen a `rules[]` entry, or downgrade its `severity` to `warn` — the check only fails on `v.severity === "error"` (`contract/index.ts:306`);
   - add a `slice.json` exclude — a path inside an exclude is not in the slice, so it is never judged (`slice-path.ts:81-86`, and for a target `contract-eval.ts:29-36`);
   - drop an `expires` entirely, or lose one silently through `contract check --baseline --yes`, which discards a past date (`contract/index.ts:274-280`).
2. **Entries with no `expires` and no `reason`.** The format allows them (`contract.ts:44-55`, both optional; `brownfield-sidecar.ts:222-230` validates only a date that is present). A policy flag would warn on them.
3. **The generated CI gate does not run `contract check`.** `conformance-gate-files.ts` runs `hexagen-lint --ratchet` and `hexagen sync --check`, which need a manifest. A client repo with only `.hexagen/` has no gate job. Covered by plan 5's CI recipe, not here.

## 4. Command spec (gap 1 only)

**Stated precondition: `.hexagen/contract.json` and `.hexagen/slice.json` are tracked.** Every writer excludes `.hexagen/` (§2), so a CI checkout has neither file until the client stages them. Before the first gate run:

```bash
hexagen observe --out .hexagen/observed.json --yes
hexagen slice init --path <p>… --exclude <p>… --yes
hexagen contract add-rule … --yes
hexagen workbook export --stage .hexagen/slice.json .hexagen/contract.json --yes
```

Both files are on the export allow-list (`workbook/allow-list.ts:22-28`), and `--stage` prints the diff and stages exactly the named files with `git add -f`, writing nothing else. Re-run it after every `contract` or `slice` write that must be judged. A file that was never staged is not growth; it is missing input, and §4's exit-2 rule says so.

```
hexagen contract check --base <git-ref> [--allow-growth --reason <text>]
```

- Reads `.hexagen/contract.json` and `.hexagen/slice.json` **both** at `<git-ref>` and in the working tree, and compares the whole of each. Baseline entries alone are not enough: the rules and the excludes are where the bypasses live (gap 1).
- The file at `<git-ref>` is read with `GitReader.show(hash, relativePath)` (`report/types.ts:46-53`; the `git show <hash>:<path>` at `report/exec-git.ts:41-43`) — a point read at one commit, the same call the ratchet trend already uses (`report/ratchet-trend.ts:12`). Not a new git reader, and not a diff range; plan 1's git-range helper is a different need and does not gate this.
- `GitReader.show` returns `null` for an unresolvable ref **and** for an absent path, because its `git` helper swallows every failure (`report/exec-git.ts:4-14`). Resolve `<git-ref>` first (`git rev-parse --verify <ref>^{commit}`) and read the file second, or the two exit-2 causes cannot be told apart.
- Growth — exit 1, unless `--allow-growth --reason <text>`, and the reason is printed so the CI log carries it:

| #   | Growth                                                                 | Why it is growth                                                                                       |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | a `knownViolations` entry not present at `<git-ref>`                   | entries match on rule, file and specifier (`contract-eval.ts:108-119`)                                 |
| 2   | an entry's `expires` pushed later                                      | `YYYY-MM-DD`, compared as dates (`isSuppressionExpired` reads the same form, 83-105)                   |
| 3   | an entry's `expires` dropped, including the silent drop on re-baseline | `contract/index.ts:274-280` throws the date away with no flag and no message                           |
| 4   | a `rules[]` id present at `<git-ref>` and gone in the tree             | a removed rule stops judging (`contract.ts:11-24`)                                                     |
| 5   | a rule's `severity` moved `error` → `warn`                             | the check fails only on `error` (`contract/index.ts:306`)                                              |
| 6   | any edit to a rule's `kind`, `from` or `to`                            | see below                                                                                              |
| 7   | a `slice.json` exclude not present at `<git-ref>`                      | excludes deny before paths match (`slice-path.ts:81-86`), so a new exclude removes files from the gate |

- Row 6 is deliberately blunt. `forbid A→B` fails on an edge that lands in `B`; `allow-only A→B` fails on an edge that leaves `A` for anywhere but `B` or `A` (`edgeViolatesRule`, `contract-eval.ts:63-74`), so the two kinds fail on disjoint edge sets and "stricter" is not a comparison the guard can make about a prefix edit. Any `kind`, `from` or `to` difference is reported as `rule <id> <field> changed` and needs `--allow-growth --reason`, which is the same review a baseline entry gets.
- Not growth: an entry removed, an `expires` shortened, a rule added, an exclude removed.
- A file absent at `<git-ref>` is exit 2, with the message `file absent at base because it was never staged`. With `.hexagen/` in the exclude file, "the client never staged this" and "this is the commit that adds the slice" look identical to `git show`, so there is no first-commit pass. Bootstrap by staging the file (precondition above), not by waving the guard through.
- `--base` with `--baseline` is a usage error, exit 2: the baseline branch returns before any comparison (`contract/index.ts:253-295`), so the guard would be a silent no-op on a command that writes.
- Where it runs: after the slice-id and working-tree contract parse, **before** the `observed.json` load and its stale-input exit (`contract/index.ts:234-245`). The guard reads two files and no observations, so a client that staged `contract.json` and `slice.json` but not `observed.json` gets its growth reported instead of a stale-input exit 2 that says nothing about growth.
- Exit codes, the same three as `contract check` (`README.md:420-427`): 0 clean, 1 growth or violation, 2 bad input — an unresolvable ref, a shallow clone, `--allow-growth` without `--reason`, `--base` with `--baseline`, a file absent at `<git-ref>`, a base contract that does not parse.

Where the code goes: the comparison is pure, so it belongs in `packages/shared/src/types/brownfield/contract-eval.ts` beside `findKnownViolation`, where the CLI and the browser viewer already share the rule semantics; the git read stays in the command. No schema change — every field compared already exists on `Contract` (`contract.ts:67-74`) and `Slice` (`slice.ts:11-19`).

## 5. Scope

In: the `--base` guard over `rules[]`, `knownViolations` and the slice excludes; a warning for entries lacking `reason` or `expires`; the `--base` rows of the README section and its exit-code table.
Out: changes to the arch-linter baseline, UI, a new baseline file format, auto-baselining on `scan`, a change to the `Contract` or `Slice` schemas. If plan 3's `closed` kind lands first, extend the row-6 comparison then; 2A adds no `closed` special case.

## 6. Acceptance tests

At unit level, in `packages/sync/__tests__/commands/contract/contract.test.ts`, on a real git repo (`makeRepo`, `commands/slice/fixture.ts:31-42`), committing `.hexagen/contract.json` at the base with `git add -f` because the fixture's exclude file holds it:

1. Adding a violation entry in a branch fails against the base.
2. Removing an entry passes.
3. Extending an entry's `expires` fails as growth.
4. `--allow-growth` without `--reason` exits 2.
5. An unresolvable base ref exits 2, never 0.
6. A `contract.json` absent at the base exits 2 and says the file was never staged — never that this is a first commit.
7. A violation that is baselined at the base still passes `contract check` with no `--base`.
8. Deleting a `rules[]` entry fails as growth, naming the id.
9. Downgrading a rule's `severity` to `warn` fails as growth, naming the id and the field.
10. Editing a rule's `from` or `to` fails as growth, naming the id and the field, including a narrowing.
11. Adding a `slice.json` exclude fails as growth.
12. An entry's `expires` dropped in the tree fails as growth, including the re-baseline case of `contract/index.ts:274-280`.
13. Shortening an `expires` passes, and a removed entry passes — the two non-growth cases, so a guard that only ever fails is not the only thing tested.
14. `--allow-growth --reason "…"` on each growth row exits 0 and prints the reason.
15. The guard reports growth with no `observed.json` in the working tree, so the stale-input exit does not mask it.
16. `--base` with `--baseline` exits 2 and writes nothing.
17. At built-CLI level, in `packages/sync/__tests__/contract/exit-codes.contract.test.ts` on the published layout (`__tests__/helpers/published-layout.ts`, after rebuilding `packages/sync`): `contract check --base HEAD` in a fixture with no `.hexagen/` exits 2, and in one with a committed contract exits 0. That fixture has no git repo today (`createFixture`, `__tests__/helpers/fixture-factory.ts:52-66`), so the case needs `git init` and a commit in the fixture root.

## 7. Risks

- A person with write access to the branch can pass `--allow-growth`. The reason lands in the CI log, which is the only check; say that plainly.
- `--base` is client-supplied, so a workflow that lets a PR pick its own base ref can point the guard at the PR head, diff nothing and pass. The recipe must pass the merge base; that is a workflow change, not a flag default.
- The guard is only as strong as the staging. A client who never runs `workbook export --stage` gets exit 2 on every PR, which is the correct failure but reads like a broken CLI until the precondition is met.
- The guard needs git history. Shallow CI clones must fetch the base. Fail with exit 2, not 0.

## 8. Liveness proof (Step Zero)

PR body shows:

- `packages/sync/__tests__/commands/contract/contract.test.ts` executed, not merely imported, with the growth cases red on the `makeRepo` fixture that already builds real git history;
- the command and its failing-run output on a fixture where an entry was added;
- the built-CLI exit-2 case from test 17, with the `packages/sync` build line above it.

## 9. Order

Independent of plan 1: the guard reads one file at one commit through `GitReader.show` (`report/types.ts:46-53`), not the git-range helper plan 1 extends, so there is nothing to order against. Wave 1 of the six-plan order — 2A runs in parallel with 6A, 3A and 4A, subject to §11.

## 10. Decision for the owner

**Not decided; there is no decision to record.** The owner's decisions of 2026-10-02 cover plans 1, 3, 4, 5 and 6, and the hold on PR #751. None of them is about plan 2, and this plan's review entry carries no decision either, so writing "decided (owner, 2026-10-02)" here would put a choice and a date into the log that the owner never made. The section stands open.

Settled by the review rather than by the owner — each a rejected alternative, one line:

- Compare the whole contract and the slice excludes, not `knownViolations` alone: diffing the baseline list alone leaves the rule set and the excludes as unguarded bypasses.
- Reuse `GitReader.show`, do not build a git reader: `report/types.ts:46-53` already returns `string | null` for `git show <hash>:<path>`.
- An absent file at `<base>` is exit 2 naming the staging cause, not a first-commit pass: with `.hexagen/` excluded, the two are indistinguishable to `git show`.
- No `--allow-growth` escape for a missing base file: exit 2 is bad input, and `--allow-growth` is the door for reviewed growth, not for missing state.

Open for the owner:

- Flag or subcommand: `contract check --base <ref>` (this plan's recommendation — the gate is already one command and the exit-code table already exists) against a separate `contract ratchet` (clearer in a CI log, one more subcommand to carry in the README and in the exit-code contract suite).
- Whether the guard ships at all before the §4 precondition is in the client's workflow. Without the staging step it is exit 2 on every PR, and the alternative across the six plans is leaving the baseline list unguarded.

## 11. Lanes

**2A — the `--base` guard.** Everything in §4: the comparison, the flags, the README rows, the tests.

- **Order:** wave 1 of the six-plan order, in parallel with 6A, 3A and 4A. No dependency on plan 1 (§9) and none on plan 3.
- **Serialisation:** `packages/sync/README.md` is touched by plans 2 to 6, so no two lanes that edit it may run in parallel. In wave 1 that means 2A's code and test work overlaps 3A and 4A freely, but the README hunk must not: land it in its own commit, or serialise 2A's README edit behind theirs.
- **Tests to run:** `packages/sync/__tests__/commands/contract/contract.test.ts`; `packages/shared/__tests__/brownfield/contract-eval.test.ts` if the comparison lands in shared; and `packages/sync/__tests__/contract/exit-codes.contract.test.ts` **after** rebuilding `packages/sync` (`yarn turbo build --filter=@hexagen-monaco/sync --force`), because it spawns `dist/cli.js` instead of importing the source. 2A adds no CLI subcommand and no barrel name, so `packages/sync/__tests__/contract/public-surface.contract.test.ts` applies only if the lane adds a name to `packages/sync/src/index.ts` — and then it is a deliberate red-then-green edit to `EXPECTED_PUBLIC_SURFACE`, not a silent addition.
