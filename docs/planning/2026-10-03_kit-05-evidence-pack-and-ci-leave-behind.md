# Kit plan 5: evidence pack close-out and the CI leave-behind

**Date:** 2026-10-03
**Status:** plan. `evidence pack` is shipped; what remains is proving the leave-behind runs end to end in CI. Checked against `origin/main` at `951acf1d`.
**Kernel object written:** Trace (read and bundle only). No new object.
**Type of output:** audit, a documented recipe, and acceptance tests.

## 1. Goal

When the FDE leaves, the client has a CI job that runs the kit's checks and a verifiable evidence bundle, and both run with the workbench deleted.

## 2. What is on main (verified)

The thread proposal listed `evidence pack` as "command spec only". That is out of date; it shipped as BW3 (#733):

- `hexagen evidence pack <trace> --grant <file>... --out <zip>` (`packages/sync/src/commands/evidence/index.ts`, `pack.ts`, 469 lines).
- It checks the hash chain, a torn last line, Rules 1 to 3 of `docs/kernel/TRACE.md`, and the anchored tip. It writes nothing and exits 1 on any invalid line; a bundle that exists is a bundle that passed (`docs/kernel/TRACE.md` "Command spec").
- The bundle holds `bundle.json` (HMAC'd index), the trace, per-line verdicts with a separate `denials` section, `tip.json`, and the cited grants. It must resolve under `.hexagen/`.
- The reader rules are one function shared with the MCP server's `checkTrace` (`packages/shared/src/types/trace-rules.ts`), so the two cannot drift.

The CI gate that exists is for manifest repos only:

- The generated gate runs `hexagen-lint --ratchet` and `hexagen sync --check` (`packages/project-generation/src/domain/conformance-gate-files.ts`). It does not run `contract check`, `slice check`, `grant check` or `evidence pack`. I found no workflow in `.github/workflows/` that does either. A client repo that has only `.hexagen/` has no kit gate.

## 3. The gap

1. No recipe or proof that the brownfield checks run in CI in order, with exit codes the client can read.
2. `evidence pack` is a bundler. A CI job that only wants to know "is the trace valid" has to write a bundle or ignore the output. Plan 1's `evidence verify` shares this need.
3. No documented answer to where the engagement key comes from in CI. In a client repo it is `~/.hexagen/keys/<engagement>.key`, outside the repo, so CI needs it injected as a secret.

## 4. Proposed work

1. **A documented gate recipe** (README section plus a copyable workflow file) that runs, in order, and fails on the first non-zero exit:
   1. `hexagen observe --out .hexagen/observed.json --yes`
   2. `hexagen slice check --strict`
   3. `hexagen contract check` (and plan 2's `--base` once it exists)
   4. `hexagen evidence verify --since <base>` once plan 1 exists, otherwise `hexagen evidence pack` into a temp path under `.hexagen/`
2. **A fixture repo test** in `packages/sync/__tests__/` that runs the four steps on a tiny client repo with no manifest and no web app, and asserts the exit codes. This is the "runs without the workbench" proof.
3. **Key handling text**: how to inject the engagement key as a CI secret, the fingerprint printed in the log, and the warning that a missing or weak key is a denial, not a skip.
4. A shared read-only mode: `evidence pack --dry-run` or reuse plan 1's `verify`. Decision for the owner: prefer one new subcommand (`verify`) over a flag, so `pack` keeps its "a bundle that exists passed" promise.

## 5. Scope

In: the recipe, the fixture test, key text, the verify decision.
Out: a template or generator for workflows, GitHub App work, a hosted dashboard, signing the bundle with anything but the engagement key, any UI.

## 6. Acceptance tests

1. Fixture repo with a clean slice, a valid trace and no violations: all four steps exit 0.
2. Fixture with one new import crossing a forbid rule: step 3 exits 1 and the job stops.
3. Fixture with a trace line edited after the fact: step 4 exits 1 or 2 (chain broken), no bundle written.
4. Fixture with `observed.json` stale (read at another commit): step 2 exits 2 under `--strict`.
5. Fixture with no key available: step 4 exits 2 and prints no key material.
6. All four run with `apps/web` and the workbench packages not installed.
7. The recipe file has no `workflow_dispatch` write permission beyond `contents: read`.

## 7. Risks

- A green CI run says the declared checks passed on the observed edges. It does not say the agent was well behaved. State that in the README.
- Keeping the recipe and the commands in sync: the fixture test is the guard. Without it the recipe rots.
- Do not call the HMAC bundle "verifiable governance". It is signed so the accept path can refuse a tampered blob; the key is held by whoever runs CI.

## 8. Liveness proof (Step Zero)

The PR body shows the fixture test run and one failing CI run for the crossed-rule fixture.

## 9. Order

Last of the code items: it consumes plans 1 and 2. The recipe can be written earlier with `pack` in step 4.
