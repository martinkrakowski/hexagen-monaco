# Review — Conformance Positioning Arc, What Landed

**Date:** 2026-08-17
**PLAN_ID:** `0ffc9abf`
**Base:** `main` @ `dae58ec3` (PR #527 merged — planning docs only)
**Status of the code:** four **draft** PRs, stacked, not merged. This file is the review of what those PRs contain, not a claim that any of it is on `main`.

**Execution source of truth:** [`2026-08-17-fde-gtm-development-runbook.md`](./2026-08-17-fde-gtm-development-runbook.md)
**Implementation prompt:** [`2026-08-17-positioning-arc-implementation-prompt.md`](./2026-08-17-positioning-arc-implementation-prompt.md)
**Independent review (adjudication):** [`2026-08-17-positioning-plan-independent-review.md`](./2026-08-17-positioning-plan-independent-review.md) §8

---

## 1. Verdict

The runbook’s Phases −1, 0, 1, and 2 were implemented in isolated worktrees, independently reviewed to zero open issues, then assembled into a linear git stack and opened as drafts. Phase 3 (autonomous inference) and Phase 4 (enterprise pack) were **not** built. Phase 0.3 (the foreign-repo trial) remains an owner run.

Phase −1 decisions were recorded using the runbook’s recommended answers so Phases 0–2 could proceed in parallel. Those answers are now ADRs on #528. Override them there if any call is wrong; later PRs assumed them.

| Phase | PR                                                                 | Additions / deletions | Review rounds | Verdict                                    |
| ----- | ------------------------------------------------------------------ | --------------------: | ------------: | ------------------------------------------ |
| −1    | [#528](https://github.com/martinkrakowski/hexagen-monaco/pull/528) |            +693 / −32 |             2 | Approve                                    |
| 0     | [#529](https://github.com/martinkrakowski/hexagen-monaco/pull/529) |         +2,425 / −112 |             2 | Approve                                    |
| 1     | [#530](https://github.com/martinkrakowski/hexagen-monaco/pull/530) |         +3,573 / −598 |             2 | Approve                                    |
| 2     | [#531](https://github.com/martinkrakowski/hexagen-monaco/pull/531) |          +3,356 / −47 |             3 | Unverified (full monorepo gate not re-run) |

Merge from the bottom of the stack upward: **#528 → #529 → #530 → #531**. Do not merge without a human read. License files on #528 are **release-gated** — they apply from the next published release; do not push a `vX.Y.Z` tag.

---

## 2. Stack

```
main (dae58ec3)
  └── #528  execute-plan/0ffc9abf-pr-1-phase-1-decisions-as-adrs-plus-readme-lic
        └── #529  execute-plan/0ffc9abf-pr-2-phase-0-foreign-repo-validation-adopt-bo
              └── #530  execute-plan/0ffc9abf-pr-3-phase-1-fde-kit-report-ci-action-suppre
                    └── #531  execute-plan/0ffc9abf-pr-4-phase-2-platform-and-revenue-accounts-s
```

Graphite was not available. Assembly was plain git: each PR’s commits were range-cherry-picked onto the previous tip. The only stack conflict was on #530 (`packages/sync/src/cli.ts` and `tools/arch-linter/src/cli.ts`): adopt/bootstrap imports were kept, `hexagen report` was added, and `--staged` filtering runs **after** the Phase 0 vacuous-run check.

Each PR has a reviewer’s-guide comment on GitHub.

---

## 3. Binding Phase −1 answers (now ADRs)

These are what the implementers treated as accepted. They change what later PRs were allowed to build.

| ID       | ADR                                                                                           | Answer recorded                                                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-0      | [ADR-0059](../../.architecture/decisions/ADR-0059-positioning-capacity-calendar.md)           | Park architecture-remediation Phases 6–8. Positioning 0–2 is the active calendar.                                                                                                                                                                                                                                                           |
| D-3      | [ADR-0060](../../.architecture/decisions/ADR-0060-business-versus-consulting.md)              | **Business** (FSL wedge + hosted paid platform). Not consulting-only.                                                                                                                                                                                                                                                                       |
| D-1      | [ADR-0061](../../.architecture/decisions/ADR-0061-fair-source-license-split.md)               | Three-layer fair-source. Wedge = `tools/arch-linter` + adopt/bootstrap/report + CI action + **whole `packages/sync`** = FSL-1.1-Apache-2.0. Platform stays proprietary. FCL only if a self-hosted paid tier is sold. New packages default proprietary. Relicense from the next published release; ≤0.9.0 stays evaluation-licensed forever. |
| D-2      | [ADR-0062](../../.architecture/decisions/ADR-0062-readme-brownfield-claim-and-public-copy.md) | “Assisted brownfield adoption tooling.” Contact = GitHub issues with `[commercial]` title prefix. Delete “never transitions to open source.” Canonical casing **Hexagen-Monaco**. Paragraph for existing generator users.                                                                                                                   |
| quota-D2 | [ADR-0063](../../.architecture/decisions/ADR-0063-quota-metering-disposition.md)              | Leave metering as-is. Signed-in/generate inconsistency is a product question for the subscription gate.                                                                                                                                                                                                                                     |
| D-4      | [ADR-0064](../../.architecture/decisions/ADR-0064-deploy-topology-single-container.md)        | Single-container is the live topology. Fix k8s (`replicas: 1` + volume); do not delete the manifests.                                                                                                                                                                                                                                       |

ADR paths above exist on #528, not on current `main`.

---

## 4. What landed, by phase

### 4.1 Phase −1 — #528

**Commits:** `218efe9b` record the six decisions · `cf8f81dd` review fixes.

**Created**

- Six ADRs (0059–0064). ADR-0061 includes the three-layer table, FCL trigger, new-packages-default-proprietary, version boundary, trademark sentence, and the partner-facing FSL competing-use interpretation (a consultancy may run the wedge in a client repo; they may not resell “conformance as a service”).
- `tools/arch-linter/LICENSE` and `packages/sync/LICENSE` — official FSL-1.1-Apache-2.0, Copyright (c) 2026 Krakowski Cloud Solutions, LLC. No BSL Product/Change Date fields (those are not FSL).
- `packages/sync/__tests__/prepare-publish-license.test.ts` — failing-first coverage of the staging-script license rule.

**Modified**

- Root `LICENSE` — still the proprietary platform grant; preamble scopes it so it is not read as covering the FSL wedge.
- `package.json` `license` fields on the two wedge packages: `FSL-1.1-Apache-2.0`.
- Root + package READMEs: per-package license statements; brownfield claim reworded; “never transitions to open source” deleted; dual license badges; existing `@hexagen-monaco/sync` users paragraph.
- `CHANGELOG.md` — version-boundary note under unpublished 0.10.0.
- `k8s/deployment.yaml` — `replicas: 1`, `strategy: Recreate`, PVC `hexagen-monaco-quota-data` at `/data`, `QUOTA_DB_PATH` / `BYOK_DB_PATH`, pod `securityContext` `runAsUser` / `runAsGroup` / `fsGroup: 1001`.
- `scripts/prepare-publish-package.js` — missing package-local LICENSE is a hard error (no silent fallback to the proprietary root LICENSE).

**Review findings that shipped in the fix commit**

1. Bug — PVC was mounted but unwritable as `USER nextjs` (uid 1001). `fsGroup: 1001` added.
2. Suggestion — header badge still said “Source-Available” only. Split into FSL wedge + platform badges.
3. Suggestion — ADR-0059 linked the untracked remaining-work inventory. Link dropped; path cited in prose.
4. Nit — restating fixture comment rewritten to say why.

**Deviations**

- `strategy: Recreate` was not in the runbook bullet list; required so a ReadWriteOnce PVC cannot deadlock under RollingUpdate surge.
- FSL files have no Product/Change Date (correct for FSL-1.1; those fields are BSL).

**Verification:** 3 new publish-license tests (failed first, then passed). Existing staging tests still green. `yarn lint` + `yarn typecheck` passed on the implementer worktree.

---

### 4.2 Phase 0 — #529

**Commits:** `ab83b35c` adopt/bootstrap + linter hardening · `2256b50d` review fixes.

Goal of the phase: a non-vacuous, mostly-true report on a repo Hexagen did not generate, using only `layout.yaml` + a manifest. No autonomous inference.

#### 0.1 `hexagen adopt` and linter hardening

- New `.architecture/layout.yaml` schema (`tools/arch-linter/src/layout-config.ts`) — zod, `.strict()`, unknown-key rejection. Invalid config exits **2**. Absent/empty optional config keeps today’s convention mode.
- Vacuous run = **zero resolvable files scanned**, not “any missing context dir is fatal.” Exit 2; never print “Architecture is compliant.” Successful runs report `Files scanned: N`.
- tsconfig guard: accept plain `tsconfig.json` / `--tsconfig` / actionable error instead of an unguarded `tsconfig.base.json` crash.
- Configurable purity-check **source** dispatch via layout layer dirs (`src/core` → domain, `src/services` → application). `getLayerAllowedImports` / `layer-import-violation.ts` **untouched**.
- After review: cross-layer **target** classification also uses `resolveFileHexagonalLayer`.
- Scope decoupling: extra scopes from `layout.scopes` and context `package.json` names. After review, a specifier already classified as a workspace import skips `checkNpmPackageInDomain`; an unscoped name is a workspace import only if ts-morph resolves it inside a context root (`import "zod"` with a context named `zod` is not a boundary violation).
- `ignore` uses path-segment boundaries; empty patterns rejected.
- Required-communication degrades to advisory (`enforcement: "warn"`) when a layout is loaded.
- `packages/sync` layer-classifier gains an optional layout-aware mode alongside convention mode.
- `hexagen adopt` writes a detected `layout.yaml` only with `--yes`. After review, `--dry-run` works without `--yes` and does not claim a TTY prompt path that does not exist.

`tools/arch-linter/src/ratchet-baseline.ts` was **not** changed in this PR (Phase 1.3 owns the format).

#### 0.2 `hexagen bootstrap`

- Deterministic-first. Reads workspaces / package graph; proposes candidate contexts **as questions, never assertions**.
- Writes `manifest.yaml` + `layout.yaml` + empty `arch-lint-baseline.json` only after `--yes`, `--answers`, or `--stdin-json`.
- `--llm` is a documented flag that errors “not wired yet” and writes nothing (runbook allowed this if the provider stack was heavy to wire).
- After review: `--dry-run` prints `Would write:`, never `Wrote:`. Refuses to overwrite an existing manifest/layout or a populated baseline without `--force`.

#### 0.4 Trust fixes

- Deleted the stale “ships dark / NOT yet routed” comment on `ExecuteFullStagedGenerationUseCase`.
- `hasByokKey` is per-provider via `findByUserAndProvider`; revoked keys do not count. After review, the revoked-key case is tested.

**quota-D2 files were not touched.**

**Failing-first:** first unit run 7 files / 8 tests failed (53 total). After implementation + review fixes: arch-linter **168**, adopt/bootstrap unit **9**, capabilities **2**.

**DoD checks recorded against built `dist/cli.js`:** (a) zero files scanned → exit 2; (b) files-scanned count; (c) `node:fs` in `src/core` fires domain purity via layout; (d) plain `tsconfig.json` does not crash; (e) misspelled `layout.yaml` → exit 2. `hexagen --help` lists `adopt` and `bootstrap`.

---

### 4.3 Phase 1 — #530

**Commits:** `badcbda9` FDE kit · `bf574d9f` review fixes.

In scope because D-1 = fair-source wedge.

#### 1.1 / 1.5 `hexagen report` and `--handoff`

- New command under `packages/sync/src/commands/report/`.
- Self-contained HTML + Markdown: Mermaid context map from the manifest (no Next.js import), drift vs baseline, ratchet trend from `git log --follow` of `.architecture/arch-lint-baseline.json`, suppression ledger.
- `--handoff` writes a store-method zip: `hexagen-report.md`, `hexagen-report.html`, `suppression-ledger.json`, `manifest.yaml`, `layout.yaml` if present, `arch-lint-baseline.json` if present.
- Help / CHANGELOG pin the **0.10.0 unpublished** contract. The published 0.9.0 tarball does not have this command.

#### 1.2 CI action + per-PR comment

- `.github/actions/hexagen-conformance/` wraps `hexagen-lint --ratchet` + `sync --check`.
- `--pr-diff` diffs current violations against the **base-branch** baseline. Identity-key remapping uses **two-dot** `git diff --find-renames ${baseRef} HEAD` (review fix: triple-dot silently no-op’d on shallow checkouts). Git errors fail closed (exit 2). Action unshallows; this repo’s `lint.yml` checkout is `fetch-depth: 0`.
- `showFileAtRef` distinguishes a missing path at the ref (empty base baseline) from a failed `git show` (exit 2).
- Baseline **growth** is machine-enforced for the first time (was review-only).
- PR comment lists only this PR’s findings (`<!-- hexagen-conformance -->`). Clean PRs delete a stale marker comment and stay silent. Comment lookup paginates.
- This repo’s ratchet step uses the action (`skip-sync-check: true`).
- Generated `SYNC_INTEGRITY_WORKFLOW` vendors the action. A guard test pins behavioural bits (`--pr-diff`, unshallow, marker, pagination, silent-when-empty) so the in-repo copy and the generated copy cannot drift silently.

#### 1.3 Suppressions

- `parseBaseline` rejects unknown fields. Optional `reason` (non-empty) and `expires` (`YYYY-MM-DD`).
- Expired suppressions fail the gate even if the finding is gone. Same-day expiry is valid through end of that UTC day.
- `--update-baseline` merges prior `reason`/`expires` by identity key.
- Live informal `note` migrated to `reason`. Stale lint.yml “34 accepted entries” comment → **4**.

#### 1.4 Agent-constraint hardening

- Seven mutation tools (`create-context`, `add-dependency`, `create-port`, `create-adapter`, `remove-port`, `remove-context`, `scaffold-module`) only **propose** a transaction. They do not write the manifest (`validateDependency` on add-dependency is the exception).
- `hexagen_accept_transaction` is the write path. After review it **refuses** if the transaction is already terminal, then apply, then commit — a retry cannot re-run `createPort` / `scaffoldModule`.
- Reject never touches `ManifestWritePort`.
- Pre-commit: `hexagen-lint --staged --ratchet` only when `tools/arch-linter/dist/cli.js` exists (missing dist does not fail local commits).
- Workflow doc: `docs/agent-constraint-workflow.md`.

#### 1.6 Engagement security one-pager

- `docs/engagement-security.md`.
- Day-one FDE motion (lint / adopt / report) is deterministic and local.
- Named LLM paths. BYOK is a **server-side proxy** (ADR-0030): key client-held, prompts transit the server. Never air-gap. `preferLocal` falls back to the cloud chain server-side.

**Not touched:** quota files, LICENSE / license fields / `prepare-publish-package.js` / `publish.yml` (those belong to #528), `.architecture/manifest.yaml`, the two historical planning docs. No release tag.

**Suites recorded on the implementer worktree:** arch-linter 157 · mcp-server 125 · project-generation 79 · report 7. Plus review-fix suites (git-ops, mutation-approval, workflow alignment). Typecheck on the four touched packages passed. `yarn lint:arch --ratchet` green (4 suppressions). Full `packages/sync` contract suite was **not** re-run end-to-end; `report` was smoked on built `dist/cli.js`.

---

### 4.4 Phase 2 — #531

**Commits:** `6efed769` platform seam · `cea1cbc6` persistence/auth/runId fixes · `3d0a5944` initialized-flag so stale IDB cannot resurrect a deleted-all list.

In scope because D-3 = business and D-4 = single-container.

| Item                 | What shipped                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts             | NextAuth v4 + GitHub OAuth, JWT sessions kept. Custom sqlite adapter for users / account linkage. GitHub access tokens are **not** written to sqlite. `/auth/signin` uses `@hexagen/ui` + DESIGN.md tokens. Middleware matcher is `/account` and `/billing` only — generate APIs stay open.     |
| Persistence          | `SavedProjectsPersistencePort` implemented in `apps/web/lib/platform/saved-projects-store.ts` (not re-declared). 501 stub gone. Server is authoritative; IDB is cache. Rows scoped by JWT `sub` (`owner_id`). `PUT /api/projects` is a transactional whole-list replace.                        |
| Empty-server / cache | First-load empty remote + populated IDB **lifts** cache → server only when the owner has never initialized (`project_owner_state.initialized`). After a deliberate empty replace the flag is set, so a stale device cannot restore deleted projects. Non-prod DB is a tmp file, not `:memory:`. |
| Run history          | Stage telemetry via `POST /api/runs` (not via generate routes). One `runId` allocated at the start of `generate()` and passed to every `persistStageTelemetry`. Seeded `model_prices` for cost-per-run. `GET /api/runs` + `/projects/history`.                                                  |
| Billing              | Plan types `free` \| `repo`, priced on **repos not seats**. `GET /api/billing/entitlement` defaults to the existing free quota. Stripe env vars documented. **No** webhook, **no** live Stripe, **no** checkout that charges nobody.                                                            |
| Import               | `parseImportedManifest` fails closed only on empty input, YAML syntax errors, or a non-mapping document. Known fields still normalized; extras preserved.                                                                                                                                       |
| Deploy               | `PLATFORM_DB_PATH=/data/platform.db` on the existing compose `/data` volume. Single sqlite file per container.                                                                                                                                                                                  |

**quota-D2 generate-route metering diffs are empty** on:

- `apps/web/lib/enforce-quota.ts`
- `apps/web/app/api/manifest/generate/{,stage,spec,spec/convert,local}/route.ts`
- `apps/web/app/api/plan/extract-decisions/route.ts`
- `apps/web/app/api/llm/chat/route.ts`

**Review findings that shipped**

1. Bug — empty remote wiped IDB on first deploy and every `:memory:` restart.
2. Bug — project/run APIs had no session check and no `user_id` (one global list on the public host).
3. Bug — missing `runId` inflated the 14-day run count by stage count.
4. Suggestion — `saveProjects` did not delete remote ids absent from the new array.
5. Suggestion — default 20/min mutation budget too tight for project persistence (now 120/min, isolated limiter).
6. Suggestion — lift-always resurrected a deleted-all list from a stale device (`initialized` flag).
7. Suggestion — `platform-db.ts` header still forbade row-level tenancy after `owner_id` landed (header updated: one sqlite file, rows scoped by `sub`, no replica assumption).

**Verification:** `yarn workspace web lint` + `yarn workspace web typecheck` passed. First-pass Phase 2 suites 35 tests / 14 files + 20 `useStagedGenerationStream` regressions. After review fixes, implementer recorded **53 passed / 14 files** plus additional owner-state tests on the third commit.

**Intentionally not shipped:** live Stripe; Postgres multi-tenancy; signed-in unlimited generate bypass.

---

## 5. Cross-cutting constraints that held

Checked on every PR’s review:

| Constraint                                                                                                                       | Result            |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| No `vX.Y.Z` tag, no npm publish                                                                                                  | Held              |
| `.architecture/manifest.yaml` not edited                                                                                         | Held              |
| Historical planning docs (`conformance-positioning-plan.md`, `positioning-plan-validation-and-adversarial-review.md`) not edited | Held              |
| quota-D2 generate/chat/extract-decisions metering files empty-diff on Phases 0–2                                                 | Held              |
| `docs/planning/2026-08-17-remaining-work-summary.md` left untracked                                                              | Held              |
| `getLayerAllowedImports` not rebuilt (Phase 0)                                                                                   | Held              |
| DESIGN.md / `@hexagen/ui` on new sign-in UI (Phase 2)                                                                            | Held              |
| New sync commands wired for the published CLI surface (`adopt`, `bootstrap`, `report`)                                           | Held on #529/#530 |

---

## 6. What was deliberately not landed

| Item                                                      | Why                                                    |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Phase 0.3 foreign-repo trial (5–10 repos, five engineers) | Owner run; kill criterion is unprompted pull, not code |
| Phase 3 autonomous inference / Gauntlet corpus            | Explicitly deferred until a ground-truth corpus exists |
| Phase 4 enterprise (SSO/SAML, RBAC, VPC, SLA)             | Build only against a signed commitment                 |
| `--llm` enrichment on bootstrap                           | Flag exists; path errors “not wired yet”               |
| Live Stripe Checkout / webhooks                           | Would be a half-wired charge path                      |
| Postgres / multi-replica tenancy                          | Blocked on D-4; single-container sqlite is the interim |
| Signed-in unlimited generate bypass                       | quota-D2; OAuth ≠ entitlement                          |
| Relicense of already-published ≤0.9.0 tarballs            | Forbidden; evaluation license forever                  |
| Publishing 0.10.0 / pushing a release tag                 | Owner release gate                                     |

---

## 7. Review process (this execution)

- Four implementers in isolated worktrees from `origin/main`, then stacked.
- Independent reviewer persona on every PR. No self-review-only path.
- Phase 0’s first implementer died on an API capacity 500 and was retried.
- Every open issue — bugs, suggestions, nits — was fixed or `wontfix`’d with a technical reason before the PR was marked complete.
- Stack conflict on #530 resolved by the orchestrator (keep adopt + bootstrap + report; staged filter after vacuous-run abort).
- Pre-commit on the stacked #530 tip ran turbo lint + typecheck (61 tasks) and `yarn lint:arch` (4 suppressions, compliant). The stacked #531 tip was **not** re-gated as `yarn build && yarn typecheck && yarn lint` then `yarn test`; do not treat the stack as Approve until that gate is recorded.

---

## 8. Human next steps

1. Read #528 and accept or override the six ADRs. An override of D-1 or D-3 changes whether #530’s public action and #531’s platform work should ship.
2. Merge #528 → #529 → #530 → #531, or close the later PRs if a decision is reversed.
3. Run Phase 0.3 (foreign repos + five engineers). That is the Phase 0 kill gate; the code on #529 does not substitute for it.
4. Do not tag a release until you intend FSL to apply to new tarballs.
5. Phase 0.3 hand-fix log is the Phase 3 corpus seed — do not start inference without it.

---

## 9. Related documents

| Doc                                                                                                                                      | Role                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`2026-08-17-fde-gtm-development-runbook.md`](./2026-08-17-fde-gtm-development-runbook.md)                                               | Execution source of truth                               |
| [`2026-08-17-positioning-arc-implementation-prompt.md`](./2026-08-17-positioning-arc-implementation-prompt.md)                           | Implementer prompt (file inventory, gates)              |
| [`2026-08-17-positioning-plan-independent-review.md`](./2026-08-17-positioning-plan-independent-review.md)                               | Adjudication; §8 is the decision record behind the ADRs |
| [`2026-08-17-conformance-positioning-plan.md`](./2026-08-17-conformance-positioning-plan.md)                                             | Historical strategy draft — **act on nothing**          |
| [`2026-08-17-positioning-plan-validation-and-adversarial-review.md`](./2026-08-17-positioning-plan-validation-and-adversarial-review.md) | Historical first review — **act on nothing**            |
| `docs/engagement-security.md`                                                                                                            | Lands on #530                                           |
| `docs/agent-constraint-workflow.md`                                                                                                      | Lands on #530                                           |
