# FDE / Go-To-Market Development Runbook

**Date:** 2026-08-17
**Basis:** [`2026-08-17-positioning-plan-validation-and-adversarial-review.md`](./2026-08-17-positioning-plan-validation-and-adversarial-review.md) — read it first; every phase below is re-scoped from the original plan using what verification proved exists.
**Original strategy draft (superseded on execution detail):** [`2026-08-17-conformance-positioning-plan.md`](./2026-08-17-conformance-positioning-plan.md)

**Operating principle:** the conformance engine is built; the product work is _decoupling it from Hexagen-generated layouts, packaging it for engagements, and deciding who is allowed to run it._ Build order is chosen so every phase ends with a usable FDE deliverable even if the next phase is never funded.

---

## Phase −1 — Decisions before code (days, not weeks)

No engineering until these are answered. They change what gets built.

> **Version stamp (N6, corrected in adjudication):** the npm registry's latest release is **v0.9.0** (tagged); the tree is **0.10.0, untagged and unpublished** — a deliberately breaking minor (`CHANGELOG.md:8-10,42`: "A project that passed the linter on 0.9.x can therefore fail on 0.10.0"). Decide whether the CI action / quickstart targets the last published tarball or the next release, and pin it. Published tarballs (≤ the last release) remain under the evaluation license forever; the FSL relicense applies from the next release only.

> **Exit criterion for Phase −1 (adjudication):** each decision below lands as an **ADR in `.architecture/decisions/`** before any Phase 0 code — not as a runbook row. The quota-D2 near-miss (a closed decision almost reversed because its only record was a planning doc) is the cautionary tale: 61 ADR files exist and none covers licensing, metering policy, or the deploy topology.

### D-0: Capacity — one calendar (NEW, blocking)

Same branch, same day: `2026-08-17-remaining-work-summary.md` records remediation Phase 7 not started and Phase 8 partially done, while this runbook wants Phase −1 this week and 2–4 weeks of Phase 0 immediately. A solo founder cannot run both at full speed. Decide: park remediation Phases 6–8, finish the small remaining legs first, or accept Phase 0 as part-time and stretch its calendar accordingly. The positioning docs also stay out of the remediation PR (untracked planning files until deliberately committed).

### D-3 (decide BEFORE D-1): business or consulting force-multiplier

D-1's answer depends on this, not the other way around. **FSL wedge = the business answer** (bottom-up funnel needed). **Proprietary + engagement grant = the consulting answer**: keep everything proprietary and issue a one-page commercial grant (engagement + post-engagement CI use) to paying clients — no npm-license work, no conversion clock, legally simpler, smaller funnel. Both are coherent for a paid product; pick by intent, then apply D-1 below only if the answer is _business_.

### D-1: License split (blocks the entire bottom-up motion)

Current license is Source-Available Evaluation: no commercial use, no managed service, "never transitions to open source" (README only — LICENSE has no such clause). The README routes commercial licensing to Krakowski Cloud Solutions, LLC with **no contact channel** (N7).

**Recommended structure (per independent review §7 — three-layer fair-source):**

| Layer                                                       | Components                                                                                          | License                                                                                      | Rationale                                                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wedge** (free for any internal use, including commercial) | `tools/arch-linter`, future `adopt`/`bootstrap`/`report` commands, the CI action, `packages/sync`\* | **FSL-1.1-Apache-2.0**                                                                       | Free for commercial internal use (funnel needs this; current license forbids it); prohibits competing offerings; auto-converts to Apache-2.0 per-release after 2 years. |
| **Platform** (paid)                                         | Web app, staged generation, hosted history/dashboards, multi-repo, agent-constraint pack            | Proprietary commercial (current license, cleaned) — or **FCL** if self-hosted tier ever sold | This is the product. History, dashboards, agent pack = moat. FCL only if self-hosting sold.                                                                             |
| **Free tier** (hosted, quota-limited)                       | Hosted product under ToS                                                                            | Terms of service, not a code license                                                         | Already built (durable quota store). Planned GitHub-login subscription gate = paid boundary (consistent with D2).                                                       |

\* **`packages/sync` is the real D-1 sub-decision (adjudication).** Sync is the generator — closer to platform IP than wedge surface, and a 2-year Apache conversion gives the scaffolding engine away on an assumption about velocity. Options: (a) FSL the whole package (simplest publish pipeline, weakest IP posture), or (b) extract the drift-check surface (`sync --check` and what `sync-integrity.yml` consumes) into the linter package or its own small package, FSL that, and keep generation proprietary. Decide this **before** per-package LICENSE files land (checklist item 1), or the staging script's root-license fallback will ship the wrong license in a more confusing form. Two FSL-adjacent cautions for the ADR: FSL is not OSI-approved — enterprise legal will flag it, so budget legal-review cycles into the Phase 0 trial, not after the first "yes"; and FSL's competing-use clause ("same or substantially similar functionality") bars a consultancy reselling "conformance as a service" on the wedge — write the partner-facing interpretation down before anyone asks.

**Why this beats the original two options:**

- vs. Option A (Apache-2.0 open-core): FSL preserves paid product defensibility — nobody can ship "HexagenLint Cloud" or fold engine into competing harness — while losing almost no adoption surface (users Apache attracts that FSL doesn't are competitors/license-purists; funnel targets neither). DOSP conversion keeps OSS-credibility signal.
- vs. Option B (fully proprietary): current license _prohibits customer's own evaluation from touching production_, which forecloses even consulting-adjacent motion ("run it in your CI during the engagement" = commercial production use).
- **N4 makes this cheap:** sole copyright holder, no CLA debt, no contributor negotiations.

**Execution checklist (folds into Phase −1):**

1. Add per-package `LICENSE` files (FSL text in `tools/arch-linter/`, `packages/sync/`) — today staging script falls back to root evaluation license and ships it in every tarball (`prepare-publish-package.js:217-225`).
2. Rewrite `README.md:373-385`: per-package license statements; keep platform proprietary language scoped to platform; delete or scope line 381 ("never transitions to open source"); add commercial contact endpoint (N7).
3. Update both package READMEs (`packages/sync/README.md:227`, `tools/arch-linter/README.md:183`) — they currently restate evaluation terms.
4. **Record as an ADR** (N8): layer table above, FCL trigger condition, rule that new packages default to proprietary unless deliberately placed in wedge.
5. Note version boundary: already-published tarballs (≤0.9.0, the last published release — 0.10.0 is untagged/unpublished per the version stamp above) remain under evaluation license forever; relicense applies from the next release actually published. State in CHANGELOG.
6. Trademark stays out of code license: "Hexagen-Monaco" mark protected independently.
7. If external contributions ever accepted on FSL packages, add DCO/lightweight CLA _first_ — sole-ownership makes future license moves free.

### D-2: README brownfield-engine claim

"Automated brownfield ingestion engine" is advertised; nothing exists. Immediately reword to describe what Phase 0 will actually ship ("assisted brownfield adoption tooling") or remove until true. **Also** (same day): add a commercial contact endpoint (N7 — currently solicits inquiries with no email/URL/form); re-scope or delete the "never transitions to open source" sentence (N4 — it's a README assertion, not a license term; the LICENSE contains no such clause); **normalize brand casing** — the README mixes "Hexagen-Monaco" (headers) with "HexaGen"/"HexaGen Monaco" (lines 211, 375); canonical casing is **Hexagen-Monaco** (previously decided; tree normalization was deferred — public copy is where it stops being deferrable); and add one paragraph for **existing generator users** (people who installed `@hexagen-monaco/sync` for scaffolding): generation stays, the headline changes, and 0.10.0's breaking-minor notes already set the precedent for candor. One-day batch; do it the same day as D-1.

### D-4: Persistence story for >1 process — manifests fixed THIS WEEK, DB story Phase 2

`quota-store.ts` / `byok-store.ts` assume single-process better-sqlite3; `k8s/deployment.yaml:10` declares `replicas: 2` with **no volume, no mount, no db-path env** while the live compose deploy mounts `hexagen-monaco-quota-data` on `/data`. This is a today-level footgun, not a Phase 2 prerequisite (adjudication): applying the k8s manifest as written gives each replica an ephemeral empty SQLite — free-tier quotas double and reset per-pod, and **revoked BYOK keys silently un-revoke**. Two-part decision: (1) **same-day** — delete the k8s manifests or fix them (volume + `replicas: 1`) so the contradiction can't ship; (2) Phase 2 — single-container compose vs Postgres before tenancy. Recommendation unchanged: commit to single-container until the Phase 2 gate passes.

> **Rejected in adjudication — the "FSL rider / perpetual internal-use grant" appendix** (added by an earlier edit round, removed here). FSL-1.1's own grant is already perpetual per-release for every non-competing purpose, so the rider duplicated rights adopters already have; a bespoke rider on a standard license _increases_ enterprise legal-review friction (the exact objection it tried to solve); and its carve-outs purported to restrict post-conversion use, muddying the clean Apache-2.0 conversion that makes FSL legible. If a specific enterprise needs bespoke certainty, it goes in that customer's commercial agreement, never in the public license.

---

## Phase 0 — Foreign-repo validation (3–5 weeks)

**Goal:** answer the kill question — _does the conformance verdict land with engineers who aren't you, on repos Hexagen didn't generate?_ — without building inference and without first-run reputational risk.

### 0.1 `hexagen adopt` — layout-mapping config + linter hardening (~2–2.5 weeks) — THE unlock

A `.architecture/layout.yaml` mapping existing directories to contexts/layers, consumed by the linter and sync check:

```yaml
contexts:
  billing:
    root: packages/billing # or src/modules/billing
    layers:
      domain: [src/core]
      application: [src/services]
      infrastructure: [src/db, src/http]
  identity:
    root: packages/auth
ignore: [legacy/, scripts/]
```

Touch points (all verified in tree):

- `tools/arch-linter/src/cli.ts` root/manifest discovery (currently hard-fails without `.architecture/manifest.yaml` in Hexagen layout).
- `tools/arch-linter/src/cli.ts:144,304-306` — **unguarded `tsconfig.base.json` read**; must accept plain `tsconfig.json` / configurable path / try-catch with actionable error.
- `tools/arch-linter/src/cli.ts:365-367` — **silent skip of missing context dirs**; must fail loudly (exit 2) on vacuous runs. **Vacuity = zero resolvable files scanned**, not "any missing context dir is fatal" — a Hexagen-generated repo legitimately declares contexts before they're scaffolded, and adopt/bootstrap must not trip over its own output.
- `tools/arch-linter/src/cli.ts:442,514` — **hardcoded layer dispatch** (`/domain/`, `/application/` substring checks) for the **purity checks specifically**; must become configurable. Do NOT rebuild allowed-imports resolution — `getLayerAllowedImports` (`layer-import-violation.ts:70-75`) is already config-driven from `layer-rules.yaml`; only the purity dispatch is hardcoded.
- `tools/arch-linter/src/cli.ts:414` — **scope-prefix coupling** (`moduleSpecifier.startsWith(SCOPE + "/")`); must work for unscoped/multi-scoped repos.
- `packages/sync/src/domain/services/layer-classifier.ts` — the regex path→layer classifier; give it a config-driven mode alongside the convention mode.
- Rules that assume `<workspacesDir>/<ctx>/` on-disk shape (`required-communication-violation.ts` especially — make it degrade to advisory when layout-mapped).
- Ratchet (`ratchet-baseline.ts`) needs no changes — it already does exactly what brownfield landing requires.
- **`layout.yaml` gets a runtime schema (zod) with unknown-key rejection** — the existing optional-config loader is an unchecked cast (`optional-yaml-config.ts:89`), so a misspelled context or layer name would silently produce a partial report while still passing the non-empty-scan check. Invalid layout config fails loudly (exit 2); absent/empty optional config keeps today's behavior.

**Definition of done:** `hexagen-lint` produces a non-vacuous, mostly-true report on a repo with zero Hexagen ancestry, using only `layout.yaml` + a manifest. **Additional DoD:** (a) run exits 2 with clear message when zero resolvable files were scanned; (b) reports total files scanned; (c) purity-check layer dispatch works via config on a `core/`/`services/` shaped repo; (d) no ts-morph crash on plain `tsconfig.json`; (e) a misspelled `layout.yaml` mapping fails loudly (schema-validated), covered by a failing-first test. Re-estimate to **2.5–3.5 weeks** if `sync --check` layout-mapping is in scope alongside the linter (both consume the layout).

### 0.2 `hexagen bootstrap` — assisted manifest creation (~1–1.5 weeks)

Interactive, deterministic-first, no LLM required to function:

1. Read workspaces/package.json graph + ts-morph import graph (reuse `packages/sync/src/generators/port-analyzer.ts` infrastructure).
2. Propose candidate contexts from package/directory clustering — **as questions, never assertions** (the plan's §7.1 one-shot-trust rule, enforced by design).
3. Human ratifies/renames/merges in the terminal; emit `manifest.yaml` + `layout.yaml` + `arch-lint-baseline.json` in one pass.
4. Optional `--llm` flag enriches descriptions/relationship suggestions via the existing provider stack (BYOK-compatible). Full autonomous inference is a _later upgrade to this command_, developed against the ground-truth corpus (Phase 3), never the default path.

### 0.3 The trial (1 week, overlaps)

- Run adopt+bootstrap+lint on **5–10 repos you did not design**: 2–3 well-known OSS TS monorepos (cal.com, novu, twenty, medusa are good shapes) + at least one client-relationship repo (with permission).
- Hand-fix what the tooling gets wrong; log every fix — that log is the Phase 3 corpus seed _and_ the honest measure of how far bootstrap is from inference.
- Show the report to **five engineers who are not you**.

> **GATE (tightened, then refined in adjudication):** ≥3 of 5 engineers **take a costly-signal action unprompted**. Strongest signal (usage, not permission): the engineer **volunteers the tool's output into their own artifact** — cites the drift report in a code review, pastes the context map into a design doc. Also counts: asks to run it on another repo, asks for the manifest file. Weakest acceptable: lets you open a PR adding the check to their CI (this is still permission — an engineer being polite can clear it; don't let it be the only signal across all five). Agreement plus zero pull = fail. If the verdict only lands on Hexagen-generated code, stop — you own an excellent personal/consulting tool; do not fund Phase 2.

### 0.4 Trust fixes to land during Phase 0 (small, parallel)

| Fix                                                | Where                                                                                                                    | Why now                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Delete stale "ships dark / NOT yet routed" comment | `packages/agentic-interaction/src/application/use-cases/staged-generation/execute-full-staged-generation.use-case.ts:20` | Contradicts the live route; misleads every future reader |
| `hasByokKey` per-provider instead of aggregate     | `apps/web/app/api/manifest/capabilities/route.ts:22-26`                                                                  | Known defect, user-visible lie in the capabilities UI    |

Each behavior-changing fix ships with a failing-first test (fails before the fix, passes after), then the standard gate (`yarn build && yarn typecheck && yarn lint`, then `yarn test`) with the suite count recorded — per repo convention. The comment deletion is doc-only and needs no test.

> **quota-D2 (2026-08-13) — no quota code changes in Phase 0 (adjudication reversal).** Two prior drafts of this row were each wrong in opposite directions. The facts: 5 generate routes meter unconditionally; `extract-decisions` and chat correctly gate on session; BYOK is never metered (BYOK exists only on chat and returns before the quota check); the spec→convert double-charge was flagged in PR #337, recorded as decision D2 (2026-07-25), and formally closed "leave as-is" 2026-08-13 in `docs/planning/llm-execution-and-free-tier-overhaul.md:207-213` (the subscription-gate mention in ADR-0046:118 is a parenthetical, not the decision record — the closeout lives only in that planning doc, which is why Phase −1 requires ADRs). **Why the "signed-in bypass" fix is also wrong for Phase 0:** GitHub OAuth here is publish-authorization, not entitlement — no accounts table, no subscription, no billing. An unconditional bypass on the generate routes (the expensive, server-paid path, 10/day) would hand unlimited cloud generation to anyone who OAuths, before billing exists. Chat/extract-decisions bypassing while generate meters is a real inconsistency — but the conservative reading of quota-D2 is: keep metering generate until the subscription gate ships, and treat the `enforce-quota.ts:35` comment as stale relative to that decision. **Disposition: record the signed-in/generate inconsistency as a product question inside the subscription-gate design (the quota-D2 ADR), implement nothing now.** Naming note: "quota-D2" ≠ this runbook's "D-2" (README) ≠ the architecture-remediation arc's "D2" (BYOK persistence) — three live labels; always qualify.

---

## Phase 1 — The wedge / FDE kit (5–7 weeks; gated on Phase 0 + D-1)

**Goal:** the Swiss-army-knife an FDE carries into an engagement, plus (if D-1 = fair-source wedge) the public distribution surface.

### 1.1 `hexagen report` (~1 week)

Single command → self-contained HTML/Markdown engagement artifact: context map (Mermaid — reuse the accept-view renderer), drift summary vs. baseline, ratchet count and trend (from git history of `arch-lint-baseline.json` — no server needed), suppression ledger. This is simultaneously the day-one credibility deliverable, the weekly status artifact, and the handoff document.

### 1.2 CI action + PR comment (~3–4 weeks) — only if D-1 = fair-source wedge

Published GitHub Action wrapping `hexagen-lint --ratchet` + `sync --check`; comments **only violations introduced by this PR** (diff against base-branch baseline), file/line + the manifest rule violated + concrete fix. Silent when clean. The auto-injected `sync-integrity.yml` in generated projects should migrate to this action so greenfield and brownfield share one surface.

**Engineering reality check (per independent review N3):** The ratchet is a whole-repo identity baseline (`rule|file|specifier`); baseline growth is review-enforced only (`lint.yml:167-172`). Per-PR diffing requires: (a) checkout/cache of base branch per PR, (b) compute base-branch baseline, (c) diff current violations against base baseline, (d) handle renamed files (identity key breaks on rename), (e) machine-enforce baseline growth for the first time. This is **new engineering on top of the ratchet**, not a wrapper. The 1–2 week estimate in earlier drafts assumed it existed. Also amend plan §3.4's row ("enforce only on changed code" → "suppress known violations by identity; changed-code gating is Phase 1 work").

### 1.3 Suppressions with reason + expiry (~2–3 days)

Extend the ratchet format: each baseline entry may carry `reason` and `expires`; expired suppressions fail the gate. Cheap, and it's the feature that distinguishes "managed debt" from "muted linter."

### 1.4 Agent-constraint hardening (~1 week)

- Route MCP mutation tools through the transaction-approval path. **A6 part 2 is now CONFIRMED** (adjudication): seven mutation use-cases (`create-context`, `add-dependency`, `create-port`, `create-adapter`, `remove-port`, `remove-context`, `scaffold-module`) consume `ManifestWritePort` directly with zero `transactionManager` references; the `accept/reject_transaction` tools are a parallel family the mutation tools never pass through. The agent-constraint demo (§6.4 item 4 of the independent review) stays gated on this fix — the bypass is proven, not merely suspected. A6 part 1 (import round-trip = bypass, not lossless) remains the author's claim, unaudited.
- Ship a pre-commit hook invoking `hexagen_audit_boundaries` / `hexagen-lint --staged`.
- Write the workflow doc: manifest-as-context for Claude Code, "pin the agent to one context," escalation on cross-boundary edits. This is the differentiator a dependency-cruiser can't follow.

### 1.5 Handoff pack (~2 days)

`hexagen report --handoff`: report + manifest + layout + baseline + suppression ledger, zipped. "Documentation that can't go stale," made literal.

### 1.6 Engagement security one-pager (~1 day) — NEW per independent review §5.9 / §6.4

One page: what runs locally (deterministic linter, adopt, bootstrap, report, local baseline), what touches an LLM and how, data flows. **Honest sentence (adjudicated):** the day-one FDE motion (lint / adopt / report) is deterministic and local — nothing is sent anywhere; LLM-touching paths are optional, named, and off by default in engagement mode. **Never claim BYOK as air-gap**: BYOK is a server-side proxy (ADR-0030 "BYOK Server-Proxy Encryption") — the key is client-held and encrypted, but prompts still transit Hexagen's server to the provider; and `/generate/local`'s `preferLocal` falls back to the cloud chain server-side. This is the FDE channel's strongest unclaimed proof point and a procurement-first question — it survives the questionnaire only if scoped truthfully.

> **GATE (tightened per independent review Part 2):** at least two external parties running the check in CI unprompted a month after install — **or** one engagement where the client asks to keep the tooling (pays for it, or requests the handoff pack) after the engagement ends. The previous "visibly changed the client conversation" escape hatch is removed as self-judged and satisfiable by charitable interpretation. **"Running it in CI" counts only with evidence the check actually executed**: a non-zero scanned-file count in the run output and at least one observed red run (an induced or organic violation failing the gate) — a stream of green runs alone is indistinguishable from the zero-file false-green mode N1 documents.

---

## Phase 2 — Platform & revenue (8–12 weeks; gated on Phase 1 + "business" answer to D-3)

Corrected scope from verification — cheaper than the plan in places, harder in one:

| Item                                | Revised effort | Notes (what exists)                                                                                                                                                                                                         |
| ----------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts layer                      | ~1 wk          | NextAuth v4 + GitHub OAuth already gate APIs; add DB adapter, users table, middleware, sign-in page. Not "no login" — just no accounts.                                                                                     |
| Server-side project/run persistence | 2–3 wks        | Pattern exists (better-sqlite3 + Docker volume for quota/BYOK). Replace the 501 stub at `apps/web/app/api/projects/[projectId]/route.ts`; server becomes authoritative, IDB becomes cache. Honor D-4 before writing schema. |
| Run history + drift trend           | 1–2 wks        | Stage telemetry (model, duration, retries, tokens) already emitted — currently discarded at stdout. Persist it; add price table for cost-per-run. This is the paid dashboard's data.                                        |
| Multi-tenancy                       | 2–3 wks        | Confirmed absent; blocked on D-4. Single-tenant-per-deployment is an acceptable interim for consulting clients (self-hosted pack).                                                                                          |
| Billing                             | 1–2 wks        | Stripe + plan gating; metering scaffold (quota store, per-principal keying from PR #443's limiter) already exists. Price on repos, not seats.                                                                               |
| Rate limiting                       | done / small   | Merged #443; move the in-memory Map to the DB if replicas ever >1.                                                                                                                                                          |
| Import fidelity                     | 1 wk           | Finish the round-trip: today's fix is a fail-closed bypass; paid users editing imported manifests will hit it.                                                                                                              |

> **GATE:** anyone pays for hosted history/dashboards. If the free check satisfies everyone, the moat is not where the plan assumed — fall back to the consulting configuration (Phase 1 kit + services) without regret.

## Phase 3 — Inference & Gauntlet (ongoing, parallel-safe after Phase 0)

1. **Ground-truth corpus:** the Phase 0 trial repos + hand-fix logs become labeled data; grow to 10–20 repos with ratified manifests.
2. **Inference as a Gauntlet subject** (plan §4.1 — survives review): builders improve `bootstrap --llm` candidate quality; the critic _falsifies_ — generates structural predictions from the inferred manifest and checks them against the repo; precision/recall against the corpus is the bar. No corpus, no loop — the loop drifts.
3. **Gauntlet-guided remediation** (plan §4.3): sell as a service first (drift score X→Y is the invoice line), productize after two paid runs. All primitives verified in tree: drift gate, ratchet, `arch diff`, validation-suite-gated refactors, bounded-context decomposition.
4. **Semantic Tier-2 checks:** off by default; each ships only with a measured false-positive rate on the corpus.

## Phase 4 — Enterprise (against signed commitments only)

Unchanged from the plan: SSO/SAML, RBAC, durable audit log (the `AuditLogPort` seam exists in `packages/byok` — generalize it; only a console adapter is implemented today), self-hosted/VPC pack, SLA. Build nothing here speculatively.

---

## Summary card

| Phase | Duration            | Deliverable                                                                                                                                                                           | Kill criterion                                                                                                         |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| −1    | half-day of writing | D-0 calendar → D-3 (business/consulting) → D-1 license (incl. sync sub-decision) → D-2 README batch → quota-D2 (leave it) → D-4 (kill/fix k8s same-day) — **each recorded as an ADR** | —                                                                                                                      |
| 0     | 3–5 wks             | `adopt` (layout + linter hardening) + `bootstrap` + foreign-repo trial + trust fixes (comment + `hasByokKey` only)                                                                    | <3/5 engineers show unprompted pull (strongest: volunteer the output into their own artifact) → stay a consulting tool |
| 1     | 5–7 wks             | `report`, CI action (per-PR diffing), suppressions, agent hardening (A6 confirmed), handoff pack, **engagement security one-pager**                                                   | no unprompted CI usage / no engagement where client asks to keep tooling post-engagement                               |
| 2     | 8–12 wks            | accounts, server persistence, run history, billing                                                                                                                                    | nobody pays for history                                                                                                |
| 3     | ongoing             | corpus → inference → Gauntlet remediation                                                                                                                                             | corpus precision stalls                                                                                                |
| 4     | on demand           | enterprise pack                                                                                                                                                                       | no signed commitment                                                                                                   |

The single most important line in this runbook: **Phase 0 no longer means "build inference" — it means "un-couple the engine you already shipped from the layout you generated, and let five strangers judge the verdict."**
