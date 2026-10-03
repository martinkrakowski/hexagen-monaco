# Kit plan 3: slice-scoped rules, default deny

**Date:** 2026-10-03
**Status:** plan, partly shipped. Checked against `origin/main` at `951acf1d`, then against the review of the six kit plans; the owner decision of 2026-10-02 is recorded in §4.
**Kernel object written:** Manifest side of the contract (`.hexagen/contract.json`). Reads Grant and the slice.
**Type of output:** command spec and acceptance tests.

## 1. Goal

Inside a slice, anything not allowed is denied, for writes and for imports, from one declared file. The FDE should not have to list every forbidden edge to get a closed slice.

## 2. What is on main (verified)

Writes through the kit's two adapters (`grant check` and `hexagen_propose_patch`) are default deny. Editor and shell writes are not judged: either tool is the only thing that has to be stopped, not every writer on the machine:

- `hexagen grant check` in a client repo denies a path outside the slice or inside its excludes even when the grant allows it, and denies every write when `.hexagen/slice.json` is absent (`packages/sync/README.md`, §`hexagen grant show` and `hexagen grant check`, the `check` bullet at lines 165-178).
- `hexagen_propose_patch` checks that both the grant and the slice allow every path a diff touches (`packages/mcp-server/src/application/use-cases/propose-patch-tool.use-case.ts`, the ordered checks at lines 34-52: `checkWriteAgainstGrant` at step 4, the slice at step 5).

Imports are default allow, with two opt-ins to deny:

- `allow-only` rule kind: an edge from the rule's `from` prefix to anywhere that is not its `to` prefix or its own `from` prefix fails. Default deny per prefix, but written by hand (`packages/shared/src/types/brownfield/contract-eval.ts:57-74`, `edgeViolatesRule`).
- `hexagen slice check --closed` fails any edge crossing the slice boundary, all or nothing, with no way to name an accepted crossing (`runSliceCheck`, `packages/sync/src/commands/slice/index.ts:143-231`; the crossings are listed either way at lines 196-201 and fail the check only with `--closed`).
- Unresolved imports in the slice always fail (`unresolved-import` built-in rule, judged at `packages/sync/src/commands/contract/evaluate.ts:79-89`).

My earlier claim that this is "missing" was too strong: the write side is done and the import side has the primitives but not a one-step closed slice.

### Preconditions

Every writer adds `.hexagen/` to `.git/info/exclude`: `slice init` (`packages/sync/src/commands/slice/index.ts:112`), `contract add-rule` and `contract check --baseline` (`packages/sync/src/commands/contract/index.ts:98`), `observe` (`packages/sync/src/commands/observe/index.ts:739`) and `grant issue` (`packages/sync/src/commands/grant/issue.ts:384`). A CI checkout therefore has none of the three files this gate reads unless the client staged them, and the export allow-list permits all three of them (`packages/sync/src/commands/workbook/allow-list.ts:22-28`). The precondition for this plan is that the client ran, and committed:

```
hexagen workbook export --stage .hexagen/slice.json .hexagen/contract.json .hexagen/observed.json --yes
```

(`packages/sync/README.md:446-447` documents that form of the call; `--stage` takes repo-relative names, refuses anything not under `.hexagen/`, and requires each to be on the allow-list, `workbook/export.ts:658-682`.)

Without it the gate is weaker than it looks, in one specific way. `slice.json` and `observed.json` are read by `loadSlice`/`loadObserved`, which throw when the file is absent, so those are exit 2 (`packages/sync/src/commands/shared/brownfield-sidecar.ts:189-202`). But `loadContract` returns `undefined` when `contract.json` is absent (`brownfield-sidecar.ts:208-219`), and `contract check` then evaluates no rules at all (`contract/index.ts:232-251`): a client repo whose `contract.json` was never staged prints `contract for slice <id>: clean` with no `closed` rule in force. Plan 5 owns the CI recipe; its exit-2 message must say the file is absent because it was never staged, so the case is not mistaken for a first commit.

## 3. The gap

There are two gates for one idea. `slice check --closed` is blunt and `contract check` is explicit. A closed slice with a short list of accepted crossings has no single home, so an FDE either lists every forbidden edge by hand or accepts all crossings.

## 4. Proposed command spec

```
hexagen contract propose --closed
hexagen contract add-rule --kind closed --except <prefix>... [--severity error|warn]
```

1. `propose --closed` prints a candidate `closed` rule that excepts every prefix the observed edges currently leave the slice toward. It writes nothing. The human removes the excepts they do not accept. It enumerates the crossing edges `runSliceCheck` already prints (`slice/index.ts:196-201`: `isPathInSlice(edge.from)` and not `targetInSlice(edge.to)`); it cannot reuse `proposeCrossPrefixEdges`, which keeps only the edges whose _both_ ends are inside the slice (`contract/evaluate.ts:125-127`), so the leaving half would be dropped. Reuse `isPathInSlice` and `targetInSlice`; do not write a third notion of "inside the slice".
2. A `closed` rule, once added, fails any edge whose `from` is in the slice and whose `to` is neither in the slice nor under an `--except` prefix. Excludes still win. The rule carries `{id, kind, except[], severity}` and no `from`/`to`: the slice is the `from` side, and `except[]` is the whole escape hatch. `Rule` is `.strict()` (`packages/shared/src/types/brownfield/contract.ts:11-24`), so the three kinds have to be a discriminated union — `from`/`to` refused on `closed`, `except` refused on the other two — and `--from`/`--to` stop being `requiredOption` (`contract/index.ts:369-371`) and are validated only for the kinds that have them.
3. `contract check` evaluates it like any other rule, so `--baseline` and `expires` work on it with no new code path. This is the single gate. The judgement stays inside `edgeViolatesRule` in `@hexagen/shared`, which the CLI (`contract/evaluate.ts:67`) and the viewer (`apps/web/features/brownfield-workbook/middle/derive.ts:177`) both call, so the two cannot drift.
4. `slice check --closed` stays as it is. It becomes documented as the drift view; the gate is `contract check`.

**Unverified, open:** which prefix `propose --closed` emits for a file target — the file, its directory or the top-level directory. What is checked: `edge.to` is a repo-relative file path or a package root (`packages/shared/src/types/brownfield/observed.ts:64-71`); an `except` entry without a trailing `/` is matched as an exact file, not as a prefix (`underPrefix`, `contract-eval.ts:17-22`, and `matches`, `slice-path.ts:55-58`); and `normalizeSlicePath` accepts a bare directory name (`slice-path.ts:34-53`), so `libs/shared` would except only a file literally named `libs/shared`. The default proposed here, not yet confirmed against a fixture: emit the exact `to` as `slice check` prints it — a file path for a file target, the package root for a package root — and never a bare directory name; the human widens it to a directory prefix by hand. Acceptance test 6 pins it.

Interactions with what is already there:

- Excludes are honoured on the `from` side by `isPathInSlice` (`packages/shared/src/types/brownfield/slice-path.ts:81-86`) and on the `to` side by `targetInSlice` (`contract-eval.ts:29-36`). So an except cannot re-open an excluded target, and an edge whose source sits inside an `excludes` entry is not judged at all.
- A root-package target (`.`) is never inside any prefix (`prefixHasTarget`, `contract-eval.ts:45-48`), so it always violates a `closed` rule, exactly as it always violates an `allow-only` one.
- Third-party imports are `unresolved` rows judged under the built-in `unresolved-import` rule (`contract/evaluate.ts:79-89`), never edges, so a `closed` rule never sees them and no `--except` can silence one.

The strongest argument for the kind: rules are ANDed. `edgeViolatesRule` answers one boolean for one rule (`contract-eval.ts:63-74`) and `evaluateContract` raises a violation for every rule it breaks (`contract/evaluate.ts:64-77`), so two accepted crossings out of one `from` cannot be written down at all. An `allow-only` rule admits exactly one escape hatch, and a second rule over the same `from` does not add a second hatch: with `from` `app/`, the rule that allows `lib/` breaks an edge to `libs/`, because only `to` and `from` are forgiven. `closed` keeps the accepted crossings in one list, ORed inside one rule, which is the only shape that can hold them.

Decision for the owner: **decided, 2026-10-02 (owner)** — a new `closed` rule kind with `except[]`, not the recipe. Reason: the AND semantics above make two accepted crossings from one `from` inexpressible, and the recipe needs one rule per slice `paths` entry, each of which then rejects the other entries' accepted targets; `except[]` is one visible list in the file the client already keeps.

Rejected alternatives:

- the documented recipe (`allow-only` with `from` set to each slice entry) — rejected: one rule per `paths` entry, and two of them over the same `from` break each other's accepted target, so it cannot hold two accepted crossings at all.
- the status quo, `slice check --closed` as the only gate — rejected: all or nothing, so the FDE accepts every crossing or none, and the accepted set is not reviewable in a committed file.

## 5. Scope

In: the `closed` rule kind in `contract.ts` and `docs/kernel/contract.schema.json` (the `kind` enum at line 35) and in `contract-eval.ts`, `add-rule --kind closed` and `propose --closed` in `contract/index.ts`, the fixtures in `packages/shared/__tests__/brownfield/contract-eval.test.ts`, `packages/shared/__tests__/brownfield/schemas.test.ts` and `packages/sync/__tests__/commands/contract/contract.test.ts`, and the README text in §`hexagen slice` and `hexagen contract` (`packages/sync/README.md:334-430`).
Out: changing write-side enforcement, UI, per-symbol rules, auto-excepting crossings.

This is a kernel schema change, not a CLI addition. `Contract` and its `Rule` are `.strict()`, with `kind: z.enum(["forbid", "allow-only"])` and `from`/`to` required (`packages/shared/src/types/brownfield/contract.ts:11-24,67-74`), so the new kind needs a new rule shape in the zod schema and in the JSON schema together: the `contract` case of `packages/shared/__tests__/brownfield/schemas.test.ts:242-264` pins `contract.schema.json` against `Contract` and fails on a change to one alone.

Known knock-ons, out of scope here:

- The web viewer judges edges with the same `edgeViolatesRule` (`apps/web/features/brownfield-workbook/middle/derive.ts:177`), so it has to learn the kind or it will show a `closed` edge as unbroken. Its rule list also renders `r.from` and `r.to` (`middle/ProposedLayer.tsx:198-211`), which a `closed` rule does not carry, and `middle/__tests__/MiddlePanel.test.tsx:655-656` is the fixed list of rule-kind words the panel may render.
- Any consumer built before this change refuses a contract that carries a `closed` rule: the enum rejects the kind and `parseWith` turns that into a `UsageError`, so `contract check` exits 2 rather than ignoring the rule (`shared/brownfield-sidecar.ts:157-169`, `contract/index.ts:232-237`). A `closed` rule therefore cannot be backed out by pinning an older CLI; that would need the schema line to move off 1.x (`packages/shared/src/types/brownfield/common.ts:5-14`), which this plan does not do.

## 6. Acceptance tests

1. A slice with a `closed` rule and no excepts fails on any outward edge.
2. An `--except` prefix lets edges to it pass and still fails others.
3. Two accepted crossings out of one `from` both pass under one `closed` rule, and a third target from the same `from` still fails — the case in §4 that the recipe cannot express.
4. An edge into an excluded path fails even under an except that covers it, and an edge whose `from` is inside an `excludes` entry is not judged at all.
5. A baselined violation of the `closed` rule passes until its `expires` day ends.
6. `propose --closed` writes nothing, lists the observed crossing targets, and emits each target as `slice check` prints it, never a bare directory name.
7. Edges not collected (`edgesComplete` false) cannot be clean, same as today.
8. An unresolved third-party import fails under the built-in `unresolved-import` rule and never under the `closed` rule's id, whatever the excepts.
9. A root-package target (`.`) is never inside an except prefix and always violates a `closed` rule, matching the existing `allow-only` behaviour.
10. A `closed` rule carrying `from`/`to`, a `forbid` or `allow-only` rule carrying `except`, and an `except` entry that is not a slice path are each refused (exit 2), in the schema parity test and through the CLI.
11. A client repo with no `.hexagen/contract.json` gets `contract check` exit 0 with no rule in force — the precondition of §2, pinned as a test so the gap stays visible.

## 7. Risks

- Excepts are an allowlist the FDE writes, so a loose `--except src/` empties the rule. `contract show` should flag any except that covers the whole repo.
- A package-root target spelled with or without a trailing slash must be judged under both spellings, as `targetInSlice` already does. Reuse it; do not reimplement.
- The rule is only as strong as the staged `contract.json` (§2): a client that never staged it has a green gate and no `closed` rule at all, and nothing in the CLI says so.

## 8. Liveness proof (Step Zero)

The PR body shows `contract check` failing on a fixture with a `closed` rule and an outward edge, and a green run once the edge is excepted.

## 9. Order

Independent of plans 1 and 2. Plan 1 writes no contract file and plan 2's growth guard changes no rule semantics, so the "after plan 2, we both touch `contract-eval.ts`" clause the earlier draft carried is dropped: nothing in plan 2 edits the evaluator. The files this plan edits are `packages/shared/src/types/brownfield/contract.ts`, `contract-eval.ts`, `docs/kernel/contract.schema.json`, `packages/sync/src/commands/contract/index.ts` and `packages/sync/README.md`; in the sweep only `packages/sync/src/commands/contract/index.ts` and the README are shared with another plan, and the README is a serial lane (below).

## Lanes

Both lanes change the CLI surface but add no subcommand — only flags on the existing `contract propose` and `contract add-rule` — so each rebuilds before the contract suite: `yarn turbo build --filter=@hexagen/sync --force`, because `packages/sync/__tests__/contract/exit-codes.contract.test.ts` spawns the built CLI in a published layout and a stale `dist` lies. Neither lane touches a barrel: the brownfield commands are not re-exported from `packages/sync/src/index.ts:24-31`, so `packages/sync/__tests__/contract/public-surface.contract.test.ts` is needed only if a name is added to that barrel.

**3A — the `closed` kind.** Wave 1, in parallel with 6A, 2A and 4A. No dependency on another lane. Adds the rule shape to `packages/shared/src/types/brownfield/contract.ts` and `docs/kernel/contract.schema.json`, the judgement to `edgeViolatesRule`, and `add-rule --kind closed`; leaves `propose --closed` and the README to 3B. Runs: `yarn vitest run packages/shared/__tests__/brownfield/contract-eval.test.ts packages/shared/__tests__/brownfield/schemas.test.ts packages/sync/__tests__/commands/contract/contract.test.ts packages/sync/__tests__/contract/exit-codes.contract.test.ts`, then `yarn workspace web test` and `yarn workspace web typecheck`, because the viewer reads the shared types.

**3B — `propose --closed` and the README.** Wave 2, with 1A, 4B and 5A. Depends on 3A, since it adds a flag to the same command module. Touches `packages/sync/README.md` §`hexagen slice` and `hexagen contract`, which plans 2, 4, 5 and 6 also edit, so it must not run in parallel with any of them: one README lane at a time across the whole sweep. Runs: `yarn vitest run packages/sync/__tests__/commands/contract/contract.test.ts packages/sync/__tests__/commands/slice/slice.test.ts packages/sync/__tests__/contract/exit-codes.contract.test.ts`, the `slice` suite because `--closed` must keep behaving as the drift view.
