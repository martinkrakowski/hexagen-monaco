# Remaining work — development plan (post-audit)

**Date:** 2026-08-20 · **Status:** successor to [`2026-08-18-remaining-work-plan.md`](./2026-08-18-remaining-work-plan.md), whose Waves 0 / A0 / A1 / C landed in full and whose Wave B landed 2 of 5.
**Baseline:** `origin/main` @ `4dddf1e1` (**#558**; local checkouts at `b5578631` are two merges behind — fetch first).
**Companion (live status):** [`2026-08-20-remaining-work-execution-runbook.md`](./2026-08-20-remaining-work-execution-runbook.md)
**Execution wrapper:** [`2026-08-20-remaining-work-implementation-prompt.md`](./2026-08-20-remaining-work-implementation-prompt.md) (orchestrator hand-off: worktree + sub-agent delegation)

Locators are durable (file + symbol), not line numbers, per planning house style.

**Provenance.** This plan is grounded in a six-track archeology audit run 2026-08-20
against every planning document from the 2026-08-14 → 2026-08-19 window, verified
item-by-item against merged PRs **#437–#558** and the tree — not against any
document's own status table. Where a prior status table disagreed with the tree,
the tree won. The audit found **no silently dropped work**: every open item below
is either decision-gated on record or was explicitly scheduled and not yet reached.

---

## 0. How this document relates to the earlier ones

| Document                                                                                             | Role now                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`2026-08-14-architecture-remediation-plan.md`](./2026-08-14-architecture-remediation-plan.md)       | Canonical finding → item index. Item IDs stay stable. ~51 of ~62 items landed; the leftover set is §4 below.                                                                                   |
| [`2026-08-18-remaining-work-plan.md`](./2026-08-18-remaining-work-plan.md)                           | Predecessor. Waves 0/A0/A1/C complete, B partial (2/5), D untouched, E one batch. **Superseded by this file.**                                                                                 |
| [`2026-08-18-remaining-work-execution-runbook.md`](./2026-08-18-remaining-work-execution-runbook.md) | Stale — change log ends at #538; 17 merges behind. **Superseded by the 2026-08-20 runbook.** Its §6.1 rollback and §6.2 observation recipes are carried forward verbatim into the new runbook. |
| [`2026-08-17-fde-gtm-development-runbook.md`](./2026-08-17-fde-gtm-development-runbook.md)           | Positioning Phases −1…2 code landed and published (`v0.11.0`). Remaining FDE work is owner-only (§6 below). Phases 3–4 stay parked.                                                            |
| [`2026-08-19-6-7c-scout.md`](./2026-08-19-6-7c-scout.md)                                             | Consumed by #548. Historical. Its "4 suppressed" ratchet figure pre-dates #545/#550; the baseline is **1** today.                                                                              |
| `pr-comment-sweep.md` (repo root, **untracked by request**)                                          | 2026-08-19 sweep of #557/#558. Its "Needs-human" list was in no plan until now — absorbed here as **Wave S** and gates **D-P1/D-P2**.                                                          |

Every figure below was re-measured against `4dddf1e1` (or verified via `gh`/npm where the tree cannot show it).

---

## 1. What is already done (do not reopen)

- **Remediation Phases 0–6: complete.** Final legs: 6.5(c) #544, 6.7(a) #547+#554, 6.7(c) #540+#548, 6.7(d) #517.
- **Phase 8: 10 of 12.** All of 8.3–8.11 and 8.12(b)(c)(d)(e)(f)(g)(i) + VIZ-1 (#492–#526, #541–#551). Leftover: **8.12(h), 8.12(a), 8.1, 8.2**.
- **Wave A0 satellites: complete.** T4.1–T4.4 + FU-2 #536 · RI-1.3 #537 · RI-2.1+2.2 #538 · DOS-2.1 #539 · FU-1.1 #543.
- **FU-3: fully burned down.** Six pins #463/#464/#467, final three #552, eslint `@/` alias blind spot #553. `CROSS_SLICE_ALIAS_BASELINE` in `scripts/validate-ui-boundary.sh` is empty.
- **Ratchet baseline: 1 entry** (template `llm-adapter` `zod` payload row — deliberately kept red pending DOS-2.11). Arc started at 34.
- **Positioning/FDE Phases −1/0/1/2 code:** #528–#531, #533–#535; **published `v0.11.0`** (both packages, via `publish.yml` workflow dispatch 2026-08-18 — no git tag exists for it, deliberately). Live license policy is **ADR-0066** (linter FSL, sync proprietary).
- **Post-plan feature arc:** `hexagen scan` #557 + web import-and-scan #558 (zip upload → adopt/bootstrap/lint/report). All review threads resolved; residuals are Wave S below.
- Resolved decisions — do not re-litigate: D1–D4, D6, D-C0, D-L1, D-S1, ADR-0049, HEX-018-as-registry, `zod` disposition, quota-D2/ADR-0063, ADR-0065 (k8s deleted), ADR-0066 (license wedge).

## 2. Explicitly out of scope

Unchanged from the predecessor plan §2 (FDE Phases 3/4, live Stripe, signed-in bypass, D5 TS 6 as its own arc, 0.9.x patches, FSL republish of `sync@0.11.0`, canary-replacing-owner-tag, wild telemetry, client manifest backup). Additions:

| Item                                                        | Why                                                                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Streaming multipart parser for `/api/projects/scan` uploads | Sweep residual: `Content-Length` + zip-part cap is the accepted bound for v1. Re-open only on real OOM evidence.  |
| Streaming unzip (replace JSZip materialization)             | Same — peak memory is one uncompressed entry; accepted for v1.                                                    |
| Import round-trip losslessness audit (review A6 part 1)     | #531 narrowed fail-closed cases; a fidelity audit is its own arc when a round-trip demo is actually on the table. |
| "Catch up" historical planning docs                         | Banners only. Provenance stays.                                                                                   |

## 3. Decision gates

| Gate      | Question                                           | Blocks         | Recommendation                                                                                                                                                                                       | Opened     |
| --------- | -------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **D-V1**  | `@types/node` `^20` vs `^22`                       | T5.2           | Raise lock-step to `^22` (CI is 22.12). Human call.                                                                                                                                                  | 2026-08-15 |
| **D-V2**  | ESLint 8 vs 9+                                     | T5.3           | Record split as intentional **or** open a flat-config arc.                                                                                                                                           | 2026-08-15 |
| **D-V3**  | `apps/tui` React 18 / zustand 4                    | T5.4           | Likely keep (Ink peer range); document as deliberate.                                                                                                                                                | 2026-08-15 |
| **D-V4**  | `layout-engine` dagre 1 / elkjs 0.9                | T5.5           | Needs a rendering check, not just a green build.                                                                                                                                                     | 2026-08-15 |
| **D-R1a** | Stale baseline entries fatal?                      | RI-1.2         | RI-1.3 counts have now been visible since #537 — **decidable today**.                                                                                                                                | 2026-08-16 |
| **D-R1**  | Impact-analysis refuse vs warn                     | RI-2.3         | Stay at warn until a major.                                                                                                                                                                          | 2026-08-16 |
| **D-E1**  | Node parity for published CLI                      | 6.7(a) **tag** | Published-closure tests on Node 22.12 + one of 22.7/24 before a `latest` tag.                                                                                                                        | 2026-08-18 |
| **D-T11** | Template npm-dep pinning + audit                   | DOS-2.11       | **Write-up still does not exist.** Exact pins (no `^`/`~`) + `npm audit --omit=dev` on a generated fixture as a landing gate. Item stays closed until written and accepted.                          | 2026-08-18 |
| **D-P1**  | Ship `hexagen` in the production web Docker image? | S-4            | **Yes.** Web import-and-scan currently fails closed in prod (`could-not-run`) — the #558 feature is dead on deploy without it. Image/Dockerfile change touches `deploy.yml` surface → owner-flagged. | 2026-08-20 |
| **D-P2**  | Empty-baseline + live-symlink overwrite policy     | S-1 scope      | Keep current policy (overwriteable without `--force`) unless "any symlink is a blocker" is wanted. Decide once, record in the S-1 PR body.                                                           | 2026-08-20 |
| **D5**    | TypeScript 6                                       | nothing here   | Own arc.                                                                                                                                                                                             | 2026-08-16 |

## 4. Waves

```text
Wave B′  (critical path)      8.12(h) → 8.12(a)        FU-1.2 (land alone)
Wave D   (DAG, after 8.12(h)) 7.1 → 7.2 → 7.3 → 7.5 → 7.6   (7.4 ‖ 7.3)
                              7.1 → 8.1 → 8.2
Wave S   (scan hardening)     S-1 probe parity   S-4 ⇐ D-P1 (owner-flagged deploy)
Wave R   (residual polish)    R-1 … R-6  (each independent, small)
Wave E   (gated / batched)    FU-1.3 batches 2–3 → FU-1.4
                              T5.2–T5.5 ⇐ D-V*   RI-1.2 ⇐ D-R1a   RI-2.3 ⇐ D-R1
                              DOS-2.11 ⇐ D-T11
Owner    (no PR substitutes)  branch protection NOW · 6.7(a) release tail (soak → D-E1 → tag)
                              D-T11 write-up · D-V1…V4 · issues #510 #521 #428 · FDE 0.3 trial
```

**Concurrency.** ≤4 open `wave-*`-labeled PRs. Hotfixes unlabeled, don't count. No sweeper while a builder runs.

### Wave B′ — critical path

| #           | Findings        | Item                                                                                                                                                                                                | Size | Manifest edits                                                                                 | Notes                                                                                                                                                                                                                                                                                        |
| ----------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8.12(h)** | AUD-017         | Move Generate-with-AI screen-flow + device copy out of `manifest-generation` domain (`model-selection-state-machine.ts`, `GenerateWithAiScreenState`) into the web feature / model-selection layer. | L    | drop/move `manifest-generation` `context.yaml` ownership of the screen-flow symbols (Primary). | **Land alone. This is the single gate for 8.12(a) and all of Wave D.** Size it as a feature extraction.                                                                                                                                                                                      |
| **8.12(a)** | HEX-024         | model-prefs port ownership (`packages/manifest-generation/src/application/ports/out/model-preferences.port.ts`).                                                                                    | S    | move declaration with the code (Primary).                                                      | After 8.12(h).                                                                                                                                                                                                                                                                               |
| **FU-1.2**  | AUD-020 residue | `typecheck:test` on `apps/web` + fallout. **Land alone.**                                                                                                                                           | L    | none                                                                                           | Prereq 1 — **re-measure** with a throwaway tsconfig extending `apps/web/tsconfig.json`; record error/file counts + top codes in the PR body (the 110/29 figure is stale and must not size the PR). Prereq 2 — web e2e green on the same SHA. No `any` / `@ts-expect-error` / new exclusions. |

### Wave D — staged-generation GOD-001 (DAG; unchanged from predecessor)

Refuter-mandatory on every PR. Wire-compat against the `/stage` adapter **and** the web classifier. Re-exports kept one release. 7.1 may start the moment 8.12(h) lands, in parallel with anything not touching `manifest-generation`.

| #       | Findings    | Item                                                                                                                                                   | Depends     | Manifest edits                                                              |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------- |
| **7.1** | AUD-014     | Structured `notices` field on the NDJSON protocol; single advisory catalog; web stops sentence-matching; back-compat emission one release.             | **8.12(h)** | `agentic-interaction` / web ports if notices become a typed port (Primary). |
| **7.2** | AUD-015     | One shared post-Stage-4 repair module for **both** orchestrators.                                                                                      | 7.1         | none expected                                                               |
| **7.3** | AUD-016     | One R02/R03 naming module for server synthesis **and** `manifest-violation-fixer.ts`; round-trip convergence test.                                     | 7.2         | none expected                                                               |
| **7.4** | HEX-011     | Prompts / R-rule text out of `packages/agentic-interaction/src/domain/prompts/`. Standalone PR.                                                        | ‖ 7.3       | none expected                                                               |
| **7.5** | GOD-001     | Split `execute-structured-config-generation.use-case.ts` (still 3,077 lines).                                                                          | 7.3         | none expected                                                               |
| **7.6** | GOD-009/010 | Split `execute-port-mapping.use-case.ts`. **Side effects stay in infrastructure adapters behind a new outbound port; the use case orchestrates only.** | 7.5         | new outbound port on `mcp-server` `context.yaml` (Primary).                 |
| **8.1** | GOD-005     | NDJSON stream reducer as pure functions + table tests; hook binds reducer to fetch.                                                                    | **7.1**     | none                                                                        |
| **8.2** | GOD-012/003 | Spec/description hooks share the progress-binding helper; `ImportProjectSpecPage` becomes a step router.                                               | **8.1**     | none                                                                        |

### Wave S — scan/adopt hardening (from the #557/#558 sweep; previously in no plan)

| #       | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Size                  | Notes |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----- |
| **S-1** | **Probe parity across the scan family.** (a) `runAdopt` existence probe (`packages/sync/src/commands/adopt/index.ts`, `layout.yaml` check) → `lstat` + ENOENT-only swallow, same as the #557 bootstrap fix — today it swallows EACCES and treats a dangling symlink as absent. (b) Bootstrap `--dry-run` runs the overwrite probe before printing "Would write" (`commands/bootstrap/index.ts` returns before the guard today). (c) Scan `pathExists` (`commands/scan/index.ts`) → `lstat` parity so a dangling manifest doesn't silently trigger bootstrap. One PR — same defect class, three sites. RED tests per site. Apply D-P2's recorded policy. | M                     | none  |
| **S-4** | Ship the `hexagen` CLI in the production web image so `/api/projects/scan` can execute after deploy. ⇐ **D-P1**. Dockerfile/compose change; **`deploy.yml`-adjacent → owner-flagged, deploy on explicit go-ahead only.** Verify in-container: `docker exec hexagen-web hexagen --version`.                                                                                                                                                                                                                                                                                                                                                              | S code / owner deploy | none  |

### Wave R — residual polish (independent, small; each with a zero-consumers scout in the PR body)

| #       | Source                   | Item                                                                                                                                                                                                      | Size |
| ------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **R-1** | dossier 3.3              | Flip `ADR-0055` from `Proposed` to `Accepted` (it is enforced: pins burned to zero, eslint rule live). Primary-only.                                                                                      | XS   |
| **R-2** | dossier 3.6              | Delete `SecureChatDispatchUseCase` (`packages/agentic-interaction/src/application/use-cases/secure-chat-dispatch.use-case.ts`) — zero consumers. Scout proof required in PR body.                         | S    |
| **R-3** | dossier 3.7              | Retire dangling `driver_slice_exceptions` from `.architecture/invariants/layer-rules.yaml`. Primary-only (`.architecture/**`).                                                                            | XS   |
| **R-4** | plan-item 4.1 polish leg | Rename mcp-server's `ManifestGenerationPort` homonym (`packages/mcp-server/src/application/ports/out/manifest-generation.port.ts`) to a non-colliding name. Alias kept one release if externally visible. | S    |
| **R-5** | dossier 2.8              | Linter growth: application-layer npm-import rule + DOM-globals-in-domain rule, both ratcheted (baseline additions allowed at introduction, growth machine-blocked as usual).                              | M    |
| **R-6** | dossier 2.9              | Detect src-root layer-dodge (files at `src/*.ts` outside declared layers, e.g. `packages/project-configuration/src/schema.ts`). Scout first: count offenders before choosing rule vs. move.               | M    |

### Wave E — gated / batched

| #                | Item                                                                                                                                                                                                                                                                                                                   | Gate             | Size   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| **FU-1.3 b2/b3** | `typecheck:test` on the 10 remaining test-bearing workspaces, batches of 3–5: `ai-pipeline`, `core-domain`, `eslint-plugin-ui`, `manifest-generation`, `prompt-compiler`, `reconciliation-engine`, `report-governance`, `ui-projection-compiler`, `web-driver`, `apps/tui`. Batch 1 (#555) pattern: zero suppressions. | after #555 (met) | M each |
| **FU-1.4**       | Guard: every workspace with test files declares `typecheck:test`.                                                                                                                                                                                                                                                      | after FU-1.3     | S      |
| **T5.2–T5.5**    | Version-split reconciliations (each annotated in `yarn.config.cjs` `KNOWN_SPLITS` today).                                                                                                                                                                                                                              | D-V1…D-V4        | S–M    |
| **RI-1.2**       | Stale baseline entries fail behind an opt-out.                                                                                                                                                                                                                                                                         | D-R1a            | S      |
| **RI-2.3**       | Refuse impact report on unparseable in-scope file. Published breaking — next major.                                                                                                                                                                                                                                    | D-R1             | M      |
| **DOS-2.11**     | Template npm-dependency mechanism; then burn the last baseline row (template `zod`).                                                                                                                                                                                                                                   | **D-T11**        | L      |

## 5. Finding → remaining-item index

| Finding                       | Item     |     | Finding                 | Item                   |
| ----------------------------- | -------- | --- | ----------------------- | ---------------------- |
| AUD-017                       | 8.12(h)  |     | GOD-005                 | 8.1                    |
| HEX-024                       | 8.12(a)  |     | GOD-012/003             | 8.2                    |
| AUD-014/015/016               | 7.1–7.3  |     | AUD-020 residue         | FU-1.2, FU-1.3, FU-1.4 |
| HEX-011                       | 7.4      |     | dossier 2.8 / 2.9       | R-5 / R-6              |
| GOD-001                       | 7.5      |     | dossier 2.11            | DOS-2.11 ⇐ D-T11       |
| GOD-009/010                   | 7.6      |     | dossier 3.3 / 3.6 / 3.7 | R-1 / R-2 / R-3        |
| sweep 2026-08-19 §Needs-human | S-1, S-4 |     | plan 4.1 polish         | R-4                    |

## 6. Owner-only (no agent PR substitutes)

| Item                                                      | Acceptance / note                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch protection**                                     | **Overdue.** Wave 0 condition met since #535; checks green across #535–#555; live check 2026-08-20 still returns 404 (not protected). Mark `Lint & Boundaries / ESLint + UI boundary` required.                           |
| **6.7(a) release tail**                                   | #554 is unpublished (both packages still `0.11.0`). Pre-release on `next`, 14-day soak (runbook §5.2), **D-E1** Node-parity at tag time, then `latest`. Owner pushes the tag.                                             |
| **D-T11 write-up**                                        | Blocks DOS-2.11 and the final ratchet row. Nobody starts DOS-2.11 without it.                                                                                                                                             |
| **D-V1…D-V4, D-R1a, D-P1, D-P2**                          | Decisions per §3. D-R1a and D-P1 are decidable today.                                                                                                                                                                     |
| **Issues #510 / #521 / #428**                             | All still open (verified 2026-08-20).                                                                                                                                                                                     |
| **FDE 0.3 trial**                                         | 5–10 foreign repos, five non-owner engineers, ≥3/5 costly-signal. The kill gate — still has not run. #557/#558 (`hexagen scan` + zip import) are the enablement tooling for it. Log every hand-fix (Phase 3 corpus seed). |
| **FDE Phase 1/2 gates, price sheet, §6.4 content assets** | Off-repo; tracked in the FDE runbook, not here.                                                                                                                                                                           |
| **Debug-repo deletion**                                   | Two GH-publish debug repos still to delete (pre-arc leftover).                                                                                                                                                            |

## 7. Risks

- **8.12(h)** mis-scoped as a small move stalls the whole of Wave D. It is a feature extraction; treat it as one.
- **FU-1.2** sized from the stale 110/29 figure will be wrong; type-only merges without e2e ship runtime bugs as "type safety".
- **S-4 without D-P1 sign-off** is a deploy-surface change without owner go-ahead — a standing-rule violation, not a nit.
- **DOS-2.11 without D-T11** is a supply-chain hole in emitted projects.
- **7.6 side effects in the use case** corrupt the hexagonal boundary — outbound port + adapter only.
- **R-2/R-4 without scout proofs** repeat the twice-bitten seam-edit trap; the zero-consumers grep goes in the PR body.
- **Enabling nothing:** branch protection has now been "next owner action" across three planning documents. Every day unprotected is a day a bad merge lands ungated.
- **RI-1.2** can redden unrelated PRs if stale-entry hygiene hasn't caught up; counts have been visible since #537 — check them before deciding D-R1a.

## 8. Verification (every item)

Unchanged from the predecessor plan §8: failing-first RED→GREEN; inverse-edit restores (never `git checkout`); Quality Gate `yarn build && yarn typecheck && yarn lint && yarn test` (+ `yarn lint:arch` on port/adapter/`.architecture` changes) with the suite count quoted in the landing record; Manifest-edits column is the checklist; ratchet keys deleted in the burning PR; reporter forced when measuring; release-gated items follow runbook §5; no AI attribution; named-path staging; neutral phrasing.

## 9. Ready when

- **Wave B′** can start immediately — nothing gates 8.12(h).
- **Wave D's 7.1** starts only after 8.12(h) lands.
- **8.1/8.2** only after 7.1.
- **Wave S S-1** can start immediately; **S-4** only after D-P1.
- **Wave R** items are ungated; schedule opportunistically inside the concurrency cap.
- **Wave E** per its gates; **FU-1.3 batch 2** can start immediately.
- Plan is **done** when: Waves B′/D/S/R merged; FU-1.3/FU-1.4 complete; every §3 gate either resolved or explicitly re-parked with a dated note; ratchet baseline at 0 (post-DOS-2.11) or 1-with-reason; branch protection enabled; 6.7(a) published to `latest`.
