# ADR-0052: Published engines.node: Align the Toolchain Packages with the Repo's Node Floor

**Date:** 2026-08-14
**Status:** Proposed
**Type:** Architecture
**Relates to:** ADR-0009 (published-CLI bundling); ADR-0036 (SSR guards for browser storage APIs in Node.js 22+); MOD-004

## Context

The two packages this repo publishes to npm declare a Node floor that is lower
than the floor the monorepo itself builds and tests against:

- `packages/sync/package.json:7-8` declares `engines.node: ">=20"`
  (source name `@hexagen/sync` at line 2; published as `@hexagen-monaco/sync`).
- `tools/arch-linter/package.json:7-8` declares `engines.node: ">=20"`
  (source name `@hexagen/arch-linter` at line 2; published as
  `@hexagen-monaco/arch-linter`).

The repo, meanwhile, is a Node 22 codebase everywhere it matters:

- Root `package.json:73-74` declares `engines.node: ">=22.7.0"`, with
  `packageManager: yarn@4.12.0` (`package.json:6`).
- Every CI workflow provisions Node 22 via `setup-node`: `sync-integrity.yml:33`
  and `capstone.yml:65,96,156` pin `22.7`; the release workflow `publish.yml:42`
  pins `22.12.0` — so the published artifacts are only ever built and
  smoke-tested on Node 22.
- ADR-0036 already established that the codebase assumes Node-22 web-storage
  behaviour (`ADR-0036-ssr-browser-storage-guards-node22.md:1`, "SSR guards for
  browser storage APIs in Node.js 22+").

The consequence is a published contract that is a **fiction**: neither package
is exercised on Node 20 in CI, yet both advertise `>=20`. The 2026-08-13
architecture review flagged this as MOD-004; the 2026-08-14 audit **kept** it
at `medium` (`AUDIT-2026-08-14.md:107`) — a documentation/contract-honesty
issue, not a runtime break, since the code happens to run on Node 20 today but
is neither guaranteed nor gated to.

This is published-contract metadata, and it survives the publish transform.
`scripts/prepare-publish-package.js` strips workspace/private/dev fields and
rewrites the npm scope `@hexagen` → `@hexagen-monaco`
(`prepare-publish-package.js:48-49` for the scope constants, `:177-182` for the
name-only rewrite), but it carries `engines` **verbatim**: `engines` is in the
`RETAINED_FIELDS` whitelist (`prepare-publish-package.js:63-87`, `"engines"` at
line 81), the staging loop copies each retained field unchanged
(`:168-171`), and the script performs no rewrite of the field's value. So
whatever value sits in the source `package.json` is exactly what npm consumers
see. Fixing the source files is therefore both necessary and sufficient — no
publish-tooling change is required.

The review's candidate (ADR-C7) framed the decision as `>=20` vs `>=22.7.0`
with three options: align up to `>=22.7.0` (honest contract), keep `>=20` and
add a real Node-20 CI job that builds+tests the published CLIs, or "leave the
lie" (rejected). No customer on Node 20 is documented.

## Decision

**Align the published `engines.node` of both toolchain packages with the
repo's own Node floor: `>=22.7.0`.** (Option 1 of ADR-C7.)

1. **Set `engines.node` to `">=22.7.0"` in `packages/sync/package.json` and
   `tools/arch-linter/package.json`,** matching root `package.json:73-74`
   exactly. The contract now states the only environment the artifacts are
   actually built and tested in (`publish.yml:42` = 22.12.0; the rest of CI on
   22.7).

2. **No change to `scripts/prepare-publish-package.js`.** `engines` stays on
   the retained-fields whitelist (`prepare-publish-package.js:81`) and is
   emitted verbatim; the corrected source value flows to the published
   `@hexagen-monaco/*` manifests automatically. This is deliberately recorded
   so a future edit to the whitelist does not silently drop the field.

3. **Node 20 is not a supported target and gets no CI job.** Because no Node-20
   customer is documented, this ADR does **not** adopt ADR-C7's option 2 (a
   20.x build+test matrix). If a Node-20 consumer is ever established, the
   correct response is a follow-up ADR that either lowers the floor _and_ adds
   the compensating 20.x CI leg together, or scopes a supported-runtime policy
   — never one without the other.

This is a **published-package behavior change** and is therefore
**release-gated**: it ships with the next npm release of the toolchain packages
(explicit go-ahead required, per standing policy), alongside the plan's other
release-gated items (`2026-08-14-architecture-remediation-plan.md:367-370`).
The repo-internal execution is plan item 3.3 (its `engines.node` leg), which
carries MOD-004 (`2026-08-14-architecture-remediation-plan.md:215`); Wave-0 row
0.6 maps C7 → MOD-004 "As drafted"
(`2026-08-14-architecture-remediation-plan.md:140`).

## Consequences

- **Installs on Node 20 now warn.** `npm`/`yarn` emit an `EBADENGINE` warning
  (they do not hard-fail by default) when either published package is installed
  under Node < 22.7.0. This is the intended signal: the warning is honest about
  the only tested runtime, where the old `>=20` silently implied a support
  guarantee that CI never backed.
- **The published contract now matches the tested reality.** The artifacts are
  built and smoke-tested only on Node 22 (`publish.yml:42`, `capstone.yml`,
  `sync-integrity.yml`), so `>=22.7.0` is the strongest claim the pipeline can
  actually stand behind, and it is consistent with root `package.json:73-74`
  and the ADR-0036 Node-22 assumption.
- **No publish-tooling risk.** Because the fix is source-only and `engines`
  rides the existing whitelist verbatim (`prepare-publish-package.js:81`), the
  `@hexagen` → `@hexagen-monaco` scope rewrite and the rest of the staging
  transform are untouched.
- **Downstream / generated projects inherit nothing directly** — this is
  metadata on the two _published tooling_ packages, not on generated-project
  scaffolds. Generated projects that depend on `@hexagen-monaco/sync` or
  `@hexagen-monaco/arch-linter` will simply see the corrected engine floor when
  they install the next release; their own `engines` are unaffected by this
  decision.
- **A Node-20 consumer becomes a deliberate, gated decision, not an accident.**
  Should one appear, the paired-invariant rule in Decision 3 forces the floor
  change and the 20.x CI job to land together, preventing a re-drift into an
  untested advertised runtime.
- **MOD-005's `engines.node` sub-point is subsumed here.** The audit noted
  MOD-005 also flagged an over-prescriptive engines pin
  (`AUDIT-2026-08-14.md:108`, "`engines.node` over-prescribes"); the
  security-package tsconfig half of MOD-005 is repo-internal and out of scope
  for this ADR (`2026-08-14-architecture-remediation-plan.md:370`, and gated on
  ADR 0.3 keeping the security package per plan `:215`).
