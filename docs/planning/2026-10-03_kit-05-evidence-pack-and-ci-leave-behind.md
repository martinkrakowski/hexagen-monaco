# Kit plan 5: evidence pack close-out and the CI leave-behind

**Date:** 2026-10-03
**Status:** plan. `evidence pack` is shipped; what remains is proving the leave-behind runs end to end in CI. Checked against `origin/main` at `951acf1d`.
**Kernel object written:** Trace (read and bundle only). No new object.
**Type of output:** audit, a documented recipe, and acceptance tests.

## 1. Goal

When the FDE leaves, the client has a CI job that runs the kit's checks and an HMAC'd bundle the client can re-check with the engagement key, which refuses a tampered blob, and both run with the workbench deleted.

## 2. What is on main (verified)

The thread proposal listed `evidence pack` as "command spec only". That is out of date; it shipped as BW3 (#733):

- `hexagen evidence pack <trace> --grant <file>... --out <zip>` (`packages/sync/src/commands/evidence/index.ts`, `pack.ts`, 469 lines).
- It checks the hash chain, a torn last line, Rules 1 to 3 of `docs/kernel/TRACE.md`, and the anchored tip. It writes nothing and exits 1 on any invalid line; a bundle that exists is a bundle that passed (`docs/kernel/TRACE.md` "Command spec").
- The bundle holds `bundle.json` (HMAC'd index), the trace, per-line verdicts with a separate `denials` section, `tip.json`, and the cited grants. It must resolve under `.hexagen/`.
- The reader rules are one function, `traceRuleReasons` (`packages/shared/src/types/trace-rules.ts:44`). Its live callers are `hexagen evidence pack` (`packages/sync/src/commands/evidence/check.ts:131`) and `hexagen workbook export`, which runs the same pack logic (`packages/sync/src/commands/workbook/export.ts:27`), so those two cannot drift. The MCP server's `checkTrace` (`packages/mcp-server/src/application/kernel/trace.ts:100`) calls the same function but is itself reached only from its own test (`packages/mcp-server/__tests__/application/kernel/trace.test.ts`); nothing in `packages/mcp-server/src` or the barrel calls it, so it is a mirror to keep honest, not a second live reader. The doc comment at `trace-rules.ts:4` still names `checkTrace` as a caller and is now stale.

The CI gate that exists is for manifest repos only:

- The generated gate runs `hexagen-lint --ratchet` and `hexagen sync --check` (`packages/project-generation/src/domain/conformance-gate-files.ts`). It does not run `contract check`, `slice check`, `grant check` or `evidence pack`. I found no workflow in `.github/workflows/` that does either. A client repo that has only `.hexagen/` has no kit gate.

## 3. The gap

1. No recipe or proof that the brownfield checks run in CI in order, with exit codes the client can read.
2. `evidence pack` is a bundler. A CI job that only wants to know "is the trace valid" has to write a bundle or ignore the output. Plan 1's `evidence verify` shares this need.
3. No documented answer to where the engagement key comes from in CI. In a client repo it is `~/.hexagen/keys/<engagement>.key`, outside the repo, so CI needs it injected as a secret.

## 4. Proposed work

### 4.0 Precondition: the `.hexagen/` files this recipe reads must be committed

Every writer adds `.hexagen/` to `.git/info/exclude`, so a CI checkout has none
of it: `ensureExcluded(root, ".hexagen/")` runs in `slice init`
(`packages/sync/src/commands/slice/index.ts:112`), in `contract add-rule` and
`contract --baseline` (`contract/index.ts:98`), in `observe`
(`observe/index.ts:739`) and in `grant issue` (`grant/issue.ts:384`). The FDE
stages the files once, locally, with the export, whose allow-list does permit
them (`packages/sync/src/commands/workbook/allow-list.ts:22-28` for the fixed
five, `:62-63` for `grants/*.json`). The exact list plan 5 needs:

```bash
hexagen workbook export --stage --yes \
  .hexagen/slice.json \
  .hexagen/contract.json \
  .hexagen/observed.json \
  .hexagen/evidence/trace.jsonl \
  .hexagen/evidence/tip.json \
  .hexagen/grants/<every grant the trace cites>.json
```

Why each one, all checked on main at `951acf1d`:

- `slice.json` — steps 2 and 3 both `loadSlice` it, and step 4 takes the
  engagement id from it when `--engagement` is absent
  (`packages/sync/src/commands/evidence/pack.ts:171-175`).
- `contract.json` — step 3.
- `evidence/trace.jsonl` — step 4 takes the trace as an argument but accepts
  only that exact path, because the tip anchors one file
  (`pack.ts:153-169`; anything else is exit 2).
- `evidence/tip.json` — the anchor. With it, a removed line or a restart from
  genesis is exit 1 (`pack.ts:274-286`); without it a missing tip is not a
  problem at all (`pack.ts:248-255`), `tipChecked` stays false and the index
  records `tipAnchoredBefore: false` (`pack.ts:332`), so a truncated tail
  passes. A staged tip is what makes step 4 catch truncation.
- `grants/*.json` — `--grant` is required (`pack.ts:149-151`), and a line whose
  `grant_id` matches no passed grant fails Rule 3
  (`packages/shared/src/types/trace-rules.ts:49-52`).
- `observed.json` — not needed by steps 1 to 4, because step 1 rewrites it.
  Stage it anyway so a run that starts at step 2, and a fresh clone, agree; a
  missing one is exit 2 either way (`NotFoundError extends UsageError`,
  `packages/sync/src/commands/shared/brownfield-sidecar.ts:30,33-44`).

So the recipe's first step checks these paths are tracked before any kit command
runs, and exits 2 naming the first one that is not, with the `--stage` command to
run. An un-staged repo must not look like a first commit.

### 4.1 The recipe

1. **A documented gate recipe**: a README section with a copyable workflow
   block, run in this order and numbered as the acceptance tests number them.

   - **Step 0** — `git ls-files --error-unmatch <each path in §4.0>`. The
     precondition. Not a kit command, and the only step that reports a missing
     path by name.
   - **Step 1** — `hexagen observe --out .hexagen/observed.json --yes`.
     Fail-fast.
   - **Step 2** — `hexagen slice check --strict`. **Not** fail-fast; see below.
   - **Step 3** — `hexagen contract check`. Fail-fast. Plan 2's `--base` joins it
     in 5B.
   - **Step 4** — `hexagen evidence pack <trace> --grant <each staged grant> --out .hexagen/<temp>.zip`
     in 5A, `hexagen evidence verify --since <base>` in 5B. Fail-fast.

   Every step prints its own exit code, so a client can tell 1 (a violation) from
   2 (bad input or stale state): `slice check` is 0 clean / 1 drift / 2 bad input
   or stale `observed.json` (`slice/index.ts:292-294`), `contract check` is
   0 / 1 violation / 2 bad input or stale (`contract/index.ts:409-412`), and
   `evidence pack` is 0 packed / 1 the evidence is invalid, nothing written /
   2 usage or precondition (`pack.ts:56`).

   **Step 2 leaves the fail-fast chain.** `runSliceCheck` fails on any in-slice
   file changed since `slice.repo.commit` (`slice/index.ts:176-183`, and
   `failed` at `:217`), and `slice init` writes that commit once and refuses to
   overwrite an existing slice (`:100-104`), so after the first in-slice commit
   every PR exits 1 at step 2, forever. That is a property of the engagement, not
   of the PR, and it carries no per-PR signal. The recipe runs step 2, prints its
   code, fails the job only on exit 2 (bad input or stale state), and logs exit 1
   as a drift notice. The durable fix is `hexagen slice check --since <base>`,
   which does not exist today — the check's only flags are `--strict`, `--closed`
   and `--root` (`slice/index.ts:296-298`) — and it arrives with plan 1's
   `changedSince` extension (`packages/sync/src/commands/shared/brownfield-sidecar.ts:115-129`),
   not as a second git-range helper. When it lands, step 2 rejoins the fail-fast
   chain.

2. **A fixture repo test** in `packages/sync/__tests__/` that runs the steps on a
   tiny client repo with no manifest and no web app, and asserts the exit codes.
   This is the "runs without the workbench" proof. It builds on the slice
   fixture helpers that already exist (`packages/sync/__tests__/commands/slice/fixture.ts`:
   `makeRepo`, `writeObserved`, `git`, `cleanup`) rather than a second harness.
3. **Key handling text**: inject the key as a CI secret by writing it to a file
   and pointing `HEXAGEN_GRANT_KEY_FILE` at it, which is the second step of key
   resolution after `--key-file` (`packages/shared/src/node/grant-key.ts:132-153`);
   the fingerprint, which `evidence pack` never prints, so the recipe takes it
   from `hexagen grant check`, which prints the key path and fingerprint and
   never the key (`packages/sync/src/commands/grant/check.ts:100-106`); and the
   warning that a missing or weak key is a denial, not a skip — pack exits 2 with
   `cannot locate the engagement key` (`pack.ts:179-183`).

### Decision for the owner

**Decided (owner, 2026-10-02): one `verify` subcommand, reused from plan 1 — not
`evidence pack --dry-run`.** `pack` keeps its "a bundle that exists is a bundle
that passed" promise (`docs/kernel/TRACE.md` "Command spec"; `pack.ts:102-108`),
and a subcommand is also the shape the re-check already wants: the bundle index
HMAC has a library verifier with no CLI wrapper today
(`verifyBundleIndex`, `packages/shared/src/node/trace-chain.ts:562-568`), which
is the gap `verify` closes.

Rejected alternative: `evidence pack --dry-run` — rejected because it hangs a
read-only mode off the one command whose contract is that it either writes a
passed bundle or writes nothing, and it would still need the key and an `--out`
path to report anything.

## 5. Scope

In: the recipe, the staging precondition, the fixture test, the key text, and
the decision to reuse plan 1's `verify` in step 4 (5B's wiring).
Out: a template or generator for workflows (the recipe is a README block, not a
`template-engine` template), GitHub App work, a hosted dashboard, signing the
bundle with anything but the engagement key, any UI, and
`hexagen slice check --since <base>` (named above as the follow-on that puts
step 2 back in the fail-fast chain).

## 6. Acceptance tests

The steps are numbered as in §4.1, so step 0 is the precondition, 1 `observe`,
2 `slice check`, 3 `contract check`, 4 the evidence check.

1. Fixture repo with a clean slice, a valid trace and no violations, and nothing
   committed under the slice since `slice init`: every step exits 0 and the job
   exits 0.
2. Fixture with an in-slice file committed **after** `slice init`: step 2 exits 1
   with a `changed since <slice.repo.commit>` line, and the job still exits 0.
   This is the test that the gate does not stay red.
3. Fixture cloned with nothing staged: step 0 exits 2, names the first missing
   path, and says it was never staged rather than reporting a first commit.
4. The recipe prints one `step <n> exit <code>` line per step. On the
   crossed-rule fixture, step 3's line reads 1; no step line reads 0 for a step
   that failed.
5. Fixture with one new import crossing a forbid rule: step 3 exits 1 and the job
   stops.
6. Fixture with a trace line edited after the fact: step 4 exits 1 or 2 (chain
   broken), no bundle written.
7. Fixture with `observed.json` stale (read at another commit): step 2 exits 2
   under `--strict`. Kept even though step 1 prevents that state in the recipe:
   it pins `slice check`'s own stale handling for a run that starts at step 2,
   and `contract check` runs the same check (`contract/index.ts:240-245`).
8. Fixture with no key available: step 4 exits 2 and prints no key material.
9. All the steps run with `apps/web` and the workbench packages not installed.
   This extends `packages/sync/__tests__/contract/exit-codes.contract.test.ts`,
   which already spawns the built CLI in a published consumer layout, with
   `__tests__/helpers/published-layout.ts` and `__tests__/helpers/stage-publish-package.ts`
   — not a new harness.
10. The recipe's workflow block parses (`js-yaml` is already a runtime
    dependency, `packages/sync/package.json`) and its top-level `permissions` is
    `contents: read` and nothing more.

## 7. Risks

- A green CI run says the declared checks passed on the observed edges. It does not say the agent was well behaved. State that in the README.
- Keeping the recipe and the commands in sync: the fixture test is the guard. Without it the recipe rots.
- Do not call the HMAC bundle "verifiable governance". It is signed so the accept path can refuse a tampered blob; the key is held by whoever runs CI.
- The key story, which the recipe's key section has to tell:
  - The HMAC is symmetric, so the CI secret can also forge: anyone holding the
    engagement key can mint a tip or a bundle index that verifies.
  - The FDE and CI hold the same key, so a bundle cannot attribute a line to
    either of them.
  - Deleting the key is the documented emergency stop: every grant in the
    engagement stops verifying, so every write is denied
    (`docs/kernel/GRANT.md` lines 367 to 369). Rotating or deleting the key makes
    every earlier bundle unverifiable, because the tip and index HMACs are keyed
    by it (`signTip`, `signBundleIndex`,
    `packages/shared/src/node/trace-chain.ts:543-560`).
- Until 5B, step 4 is `pack`, which on success writes `tip.json` in the CI
  workspace and a zip beside it (`pack.ts:431-446`); both are discarded with the
  workspace, and a write failure removes the bundle and exits 2. That is the
  strongest argument for `verify` as the CI step, and it is why 5A's step 4 is
  written to a path the job throws away.

## 8. Liveness proof (Step Zero)

The PR body shows the fixture test run and one failing CI run for the crossed-rule fixture. The failing run is a fresh clone, so it also proves the §4.0 precondition: if the `.hexagen/` files are not committed, step 0 is what fails, and the body shows that too.

## 9. Order

5A is the recipe with `pack` in step 4 and no `--base` on step 3, so it needs neither plan 1 nor plan 2 to be correct and lands in the review's group 2, in parallel with 1A, 3B and 4B, after 2A, 3A, 4A and 6A. 5B is the swap to plan 1's `hexagen evidence verify --since <base>` plus plan 2's `--base` on step 3; it is scheduled after 1B, and 1B is conditional on Option A, which the owner deferred, so 5B waits only if Option A is ever built. The per-PR mutation signal therefore arrives in 5B, not 5A: until then step 3's contract check is the only per-PR gate in the recipe.

## Lanes

- **5A** — the §4.0 precondition step, the recipe, the step-2 exit-code
  handling, the fixture test and the key text. Depends on: nothing. Runs in
  parallel with 1A, 3B and 4B; it must not run in parallel with any other lane
  that edits `packages/sync/README.md` (plans 2–6 all do), so its merge into
  that file is serialised with theirs. Tests:
  `packages/sync/__tests__/commands/evidence/ci-leave-behind.test.ts` (new,
  in-process fixture) and `packages/sync/__tests__/contract/exit-codes.contract.test.ts`.
  That suite spawns the built `dist/cli.js` and its `beforeAll` is
  `assertBuiltArtifactsPresent`, which fails on a missing `dist/cli.js` or a
  missing linter dist (`__tests__/helpers/published-layout.ts:277-286`), so
  rebuild first: `yarn turbo build --filter=@hexagen/sync --filter=@hexagen/arch-linter --force`.
  `__tests__/contract/public-surface.contract.test.ts` is only needed by a lane
  that touches a barrel; 5A does not.
- **5B** — step 4 becomes `hexagen evidence verify --since <base>`, step 3 gains
  plan 2's `--base`. Depends on: 1A, which lands the `verify` subcommand; it
  comes after 1B in the published order and is not blocked by it. Same tests as
  5A, with test 6 and test 8 re-pointed at `verify` and the same rebuild before
  the contract suite.
