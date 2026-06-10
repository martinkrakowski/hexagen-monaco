# Development Plan — Normalizer / Stage-Route Rewire Backlog

**Status:** Plan. Execution of Workstream A is gated on the assumptions below being confirmed.
**Date:** 2026-06-09
**Parents:** [normalizer-rewire-backlog.md](./normalizer-rewire-backlog.md) (what), [normalizer-rewire-scope.md](./normalizer-rewire-scope.md) (verified current state + migration strategy). This doc sequences both into PR-sized slices with exit criteria.

## Assumptions (the scope doc's open questions, with recommended defaults)

| #   | Question          | Assumed answer (overridable)                                                    |
| --- | ----------------- | ------------------------------------------------------------------------------- |
| Q1  | Cutover risk      | **Feature-flag + canary**, not straight swap                                    |
| Q2  | Local/WebLLM path | **Deferred** to a follow-on (`ClientManifestGenerationUseCase` untouched)       |
| Q3  | Quality bar       | **Golden manifests + R01–R18 pass-rate**, small human eval on the canary window |

If any assumption flips, only Workstream A's slices A3+ change shape; A1–A2, B, and C are unaffected.

## Workstream A — the rewire (sequential; the scope doc's P1–P4)

### A1 — `ExecuteFullStagedGenerationUseCase` (0→6), not yet routed — 1 PR

1. **Step-zero refresh:** re-run the liveness greps from the scope doc against current `main` (paths drift; the scope was verified 2026-06-09).
2. Build the orchestrator: construct `ExecutePromptNormalizationUseCase` / `ExecuteDomainExtractionUseCase` / `ExecuteContextClassificationUseCase` and chain into the proven 3–6 instances. Blueprint: `ExecuteStructuredConfigGenerationUseCase` — note it _runs_ 0–2 deterministically (builders), so this is a **swap of builders for LLM use-cases**, not new stage plumbing.
3. Callback surface: `onProgress(stage, durationMs)` / `onError` / `onChunk` / `onStageTelemetry` (the real interface — see PR #278 correction), adaptable to the route's NDJSON `stage-start`/`stage-complete` events.
4. **T2b (backlog §2):** constructor-inject `architectureContext`; greenfield sources the static contract from `architecture-contract.ts` + `PLANE_NAMES`. Built **once in the constructor**, never per-`execute()`.
5. **P6 resolved here (backlog §4):** the per-stage classes go live, so `escalationConfig` is no longer "dead param in dead code" — confirm tiered-timeout/fail-fast parity with the #257/#258 pattern for stages 0–2, or delete the param. Decision recorded in the A1 commit message — either wired or explicitly deleted, **not left as a dead param** (that inert-plumbing state is the exact failure mode P6 came from).
6. Tests: unit per stage boundary; integration with a mock LLM port; **smoke test at the loading seam** proving `<architecture>` is non-empty (backlog §2, not fixture-only).

**Exit:** orchestrator green in CI, zero route changes, stub untouched.

### A2 — Ban-list reconciliation — 1 PR (behavior change, HITL gate)

**Why this waits for A1 even though the lists already exist on `main`:** only the Stage-6 R01 list is live today — reconciling while one of three sites is live re-creates the dead-text-hardening trap this arc exists to avoid. A1 makes all three sites live; only then is reconciliation a production change with observable effect.

1. Land `stripe-payments` / `api-gateway` / `user-database` as **failing tests** first (per the deferred-reconciliation decision on #277).
2. Reconcile the three lists in `architecture-contract.ts` (generation / validation / deterministic blocklist) to one coherent policy; document the per-site deltas in the file header.
3. Intentional prompt-snapshot rebaseline — flagged as deliberate in the PR body (this is the one PR where snapshots _should_ change).

**Exit:** the three contradiction cases pass; rebaseline reviewed by a human.

### A3 — Cutover (assumes Q1 = flag + canary) — 1–2 PRs

1. ~~Feature flag at the `stage/route.ts` seam: stub vs `ExecuteFullStagedGenerationUseCase`.~~ **DONE — PR #288.** `STAGED_GENERATION_PIPELINE=full|stub` hard-pins (`stub` overrides the percent — the one-flip rollback lever); unset → `STAGED_GENERATION_FULL_PERCENT` canary, default 0 = ship dark; malformed/negative fails closed to stub.
2. ~~Golden-manifest comparison harness~~ **DONE — this PR.** `yarn workspace @hexagen/agentic-interaction golden-harness` runs `scripts/golden-prompts.json` (8 reference prompts) through both pipelines against the production provider chain, then judges every successful result with the **same** `ExecuteValidationReviewUseCase` (symmetric judge — the stub never runs Stage 6 itself, so comparing the full pipeline's own stage6 against nothing would be asymmetric). Per Q3 the judged R01–R18 pass-rate must not regress (gate T3 below). Pure helpers + gate math live in `scripts/golden-harness-lib.ts` (unit-tested); reports land in `golden-harness-results/` (gitignored).
3. **Quantitative rollback triggers (defined here per Q1):** any failed gate ⇒ set `STAGED_GENERATION_PIPELINE=stub` and investigate before resuming the canary.
   - **T1 — error rate:** full success-rate must not drop more than **10 pp** below stub.
   - **T2 — latency:** full p95 (successful runs) must not exceed **2× stub p95**.
   - **T3 — quality:** symmetric-judge pass-rate must not regress vs stub, **and** full output must contain **zero** banned context names (`isBannedContextName` over accepted stage2 names).
   - **T4 — empty output:** **no** successful full run may produce 0 accepted contexts.
     The harness evaluates T1–T4 per run-set and exits 1 on any failure; in the live canary the same triggers apply to the `[staged-gen] pipeline selected` log stream + done-event `pipeline` field. **Evaluability precondition:** the gates require a measured stub baseline (≥1 stub run with ≥1 success) and judge verdicts for every pipeline that produced successes — a run-set missing either is _not evaluable_ and counts as a gate FAILURE (exit 1), never a pass (e.g. an invalid API key erroring every run must not exit green).
4. Canary window → swap default → keep flag one release as the rollback lever. **Runbook + env plumbing — this PR:** [staged-generation-canary-runbook.md](./staged-generation-canary-runbook.md). Discovery: the deploy workflow regenerates prod `.env` from a guarded heredoc, so "runbook, no code" needed one deploy.yml change — the canary flags are GitHub Actions repository **variables** (`gh variable set` + deploy re-run = the whole flip; unset variables fail closed to stub/dark). "Swap default" = percent 100, deliberately not a code change (the unset default stays dark-safe; the code default flips in A4 when the stub is deleted).

**Exit:** new pipeline is the default; rollback is a flag flip.

### A4 — Cleanup — 1 PR

- Delete `ExecuteStagedGenerationUseCase` (the stub) + its inline prompts.
- Add the now-live use-cases to `agentic-interaction/context.yaml` `use_cases` (the manifest-enumeration finding declined on #277 becomes actionable).
- **P3 (backlog §2):** consume `complianceCheck` / `errorCorrectionsApplied` into `StageTelemetry` — non-blocking; a blocking HITL gate stays a separate later decision.
- Decide Option-B relocation of the canonical normalizer into `agentic-interaction` (likely moot once the stub is gone — record the decision either way).
- Update backlog + scope docs to "done"; close the loop in the `ai_manifest_staged_pipeline` memory.

## Workstream B — independents (parallel anytime; small PRs, can batch as one docs/hygiene PR)

| Item | Status (verified 2026-06-09)                                                                                                                                                                        | Action                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P7   | Confirmed: root `README.md` claims Stage-3 escalates to `gpt-4o`; config ships `escalationModel: undefined`                                                                                         | One-line README fix (describe opt-in env var, not a default)     |
| P9   | **Upgraded from "verify first" to live:** `classify-context-type` constructed at `spec/route.ts:108`; `generate-adapters` consumed by the client/WebLLM + MCP paths (see liveness correction below) | Add `escapeXml` to both prompts + injection-shaped test cases    |
| P12  | Doc drift only                                                                                                                                                                                      | Fix the `yaml-editing-disciplines.md` example (`plane:`/`file:`) |

P9 is the only one with production behavior impact — do it first, as its own PR. _Shipped as PR #279._

- **P9b (new — surfaced by #279's review validation):** the retry builders `buildLooseSpecRetryPrompt` (convert-loose-spec) and `buildStageRetryPrompt` (generate-manifest) interpolate `errorDetail` / `failedOutput` / `originalPrompt` into XML tags **unescaped**. Pre-existing, live retry paths. Deliberately excluded from #279: escaping `failedOutput` (prior LLM JSON, dense with quotes) rewrites retry-prompt bytes and may degrade the model's self-correction — needs its own evaluation, likely alongside the A2 rebaseline window.
  **P9b VERDICT (2026-06-09): no blanket escaping — by design, not by omission.** (1) `failedOutput` byte fidelity is load-bearing: the retry instruction says "Correct ONLY the invalid portions. Do not regenerate correct objects." — the model must copy correct lines byte-for-byte out of `<failed_output>`, and escaping corrupts exactly those bytes (the #279/P9c lesson applied to the retry path). (2) `originalPrompt` is our own compiled prompt with user input already escaped where contracted (`compileLooseSpecConversionPrompt` escapes `userDescription`) — re-escaping is double-escape corruption. (3) `errorDetail` is mostly our own static parse-error strings; escaping it alone buys nothing while `failedOutput` stays raw. (4) Threat model: the only author of these bytes is the prior model response on the same pipeline plus our error strings — "injection" here is the model influencing its own retry, and the output still passes the same parser/zod/deterministic-filter gates as a first attempt. Residual risk is **delimiter collision** (a literal `</failed_output>` in model output breaks framing): the surgical hardening, if ever wanted, is neutralizing only the three exact closing-tag strings — an A4-window candidate, not a blocker for A3.
- **Liveness correction (for the record):** `compileAdapterUserPrompt` is consumed by the client/WebLLM path (`client-manifest-generation.use-case.ts`, wired at `wire.client.ts:320`) and the MCP server adapter — **not** stage 4, which uses `compileStage4Prompt`. Mechanism-level attributions must be traced to the import, not inferred from proximity.
- **P9c (new — surfaced by #279's second review round):** the adapter port list carries an **exact-copy contract** ("must be one of these exactly"; both consumers validate `implements` against the raw names), so it must never be escaped — #279 briefly did and reverted (`e989691f`). The deep fix is an upstream charset constraint on port names (`PortsListEntrySchema` is `z.string().min(1)`; `normalizePortName` does not strip `&<>"'`) — e.g. `^[A-Za-z][A-Za-z0-9]*Port$` — making escape-vs-raw moot. Touches schema + normalization shared by other flows; evaluate with P9b in the A2 window. General rule worth keeping: **never escape an interpolation the model is instructed to reproduce byte-for-byte.**
  **P9c VERDICT (2026-06-09): the charset constraint is sound and empirically safe — implement it, as its own small PR, not blocking A3.** Empirical survey: 130 distinct port names extracted repo-wide (`.architecture/contexts` + `packages/template-engine/templates`), **zero** violate `^[A-Za-z][A-Za-z0-9]*$`. Gap confirmed at the chokepoint: `normalizePortName` (`normalize-draft.ts`) is trim → `toPascalCase` (strips only `[-_\s]`) → `ensurePortSuffix`, so `&<>"'` survive into prompts and validator comparisons. Implementation: extend the `normalizePortName`/`toPascalCase` chokepoint to drop non-alphanumerics (coercive — and it preserves the exact-copy contract, because normalization runs **before** both prompt interpolation and validator comparison, so both sides see the same sanitized name) + a zod `.regex` on the stage-3 parser path as the fail-closed backstop. Timing: A4 window or post-A3; the risk is live only on the WebLLM/MCP paths, which have shipped in this state since #279's revert.

## Workstream C — suspects (no investment before step-zero)

Both route through `mcp-server`; the step-zero question is the same: **is the MCP server actually served/deployed, and by whom?**

1. **C0 (shared gate):** trace `mcp-server` entrypoints to a deployment or client config. If nothing serves it, both items downgrade to "fix when MCP goes live" and exit this plan. If it **is** deployed but consumed externally rather than by this repo, P5 becomes an **API contract issue** — different owner, different urgency — not just an internal fix; record which case C0 found.
   **C0 VERDICT (2026-06-09): served internally.** `apps/tui` spawns `packages/mcp-server/dist/cli.js` over stdio (`mcp-client.service.ts`, `StdioClientTransport`). No external consumer found (no `.mcp.json`, no deploy workflow). The `hexagen-mcp` bin is a latent external surface — registrable by any MCP client — but nothing registers it today. → P4/P5 proceed as internal fixes at normal urgency, P5 first.
2. **P4** (remediation hardening: hardcoded `"gpt-4"`, no governance gate) — only if C0 passes.
   **P4 VERDICT (2026-06-09): targets were dead — deleted, not hardened.** Step-zero found `HolisticManifestRepairUseCase` / `FixManifestViolationUseCase` constructed in exactly one place: `apps/web/app/api/manifest/fix/route.ts`, whose only-ever UI consumer (`ManifestAutoFixDrawer`) was rewired to deterministic client-side patches in `53b8e90d` (2026-05-03, "replace LLM-based auto-fix with deterministic YAML patches") — zero callers remained. But the route was still **served** in the deployed web app with no auth (no `middleware.ts`, no session check in the handler): an anonymous POST would construct the provider chain and burn `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` tokens. It never wrote the manifest (returned `patchedYaml` only), so no write-governance bypass — "just" an unauthenticated LLM proxy. Hardening the gpt-4 hardcode would have been investment in dead code — the trap this arc exists to avoid. Deleted: the route, both use-cases, `extractYamlFromResponse` (zero consumers outside the two use-cases), and their barrel exports (`generateSuggestions`/`detectWarnings` kept — live via `generate-manifest-from-description.use-case.ts`).
3. **P5** (MCP governance parity: `validateDraft` vs R01–R18, no lint:arch/HITL gate) — only if C0 passes; this one is a governance-bypass risk, so it outranks P4.
   **P5 DECISION (2026-06-09, HITL):** in-process fail-closed gates now, transaction-routed HITL later. Step-zero found 7 ungated direct-mutation tools, `validateDraft` advisory-only in the generation pipeline, the linter feeding only read-only `audit_boundaries`, and a destructive merge-dump hazard (`readManifestDocument` merges split manifests; `ManifestWriteAdapter.atomicWrite` lacked the `isIndexManifest` guard that `writeManifestDocument` has — a single MCP write against a v2.0 split manifest would inline every context file into the index). Shipped gates: split-manifest write refusal in `atomicWrite`; dependency-cycle refusal (BFS path in the error) in `validateDependency`/`addDependency` + target-existence check; `removeContext` refuses while dependents exist (was: silent edge-stripping); `registerAdapter` validates `portName` against declared ports (was: accepted and ignored); generation pipeline registers contexts only when `validateDraft` diagnostics are empty (was: diagnostics returned as a footnote next to `registeredInManifest: true`). README governance-loop + TUI claims corrected to match (the TUI's `r` applies the agent's tool call immediately — it is not review-before-apply).
   **Rejected in P5:** an exec-based `yarn lint:arch` post-write gate — inert plumbing both ways (generated projects don't have the script; this repo's manifest is split, so writes are refused before any lint could run). That is the same failure mode P6 documents.
   - **P5b (follow-up):** post-write arch-lint via `resolveArchLinterBin` (in-process, not exec) with rollback-on-violation — worth doing once a live single-file-manifest MCP consumer exists.
   - **P5c (follow-up, surfaced by #282 review):** gate refusals can now strand scaffolded files — the scaffolding use-cases (`create-adapter-tool`, `create-port-tool`, `scaffold-module-tool`) write source files BEFORE the manifest registration that can refuse (pre-P5 a bad `portName` was accepted-and-ignored, so the ordering never surfaced). Fix = pre-flight the gate check before scaffolding, or clean up on refusal; evaluate alongside P5b's rollback machinery rather than duplicating it.
   - **A4-era follow-up:** route MCP mutations through the transaction/HITL approval path so the governance-loop diagram is true for agents, not just the web control plane; add a review-before-apply step to the TUI `r` flow.

## Workstream D — optional (explicitly not scheduled)

Prompt versioning (`NORMALIZER_PROMPT_VERSION` → cache key + telemetry). Trigger: an actual cache collision. Until then, no.

## Sequencing

```
B (P9 → P7/P12)          — anytime, start immediately
C0 step-zero             — anytime, 30 min, decides C
A1 → A2 → A3 → A4        — strictly ordered; A1 starts when Q1–Q3 confirmed
```

A2 _could_ precede A1 (the lists exist on `main`), but reconciling while only one of three sites is live re-creates the dead-text-hardening trap this arc exists to avoid — keep it after A1.

## Discipline (applies to every slice)

- Step-zero liveness grep before touching anything (`feedback_verify_codepath_live`).
- One concern per PR; behavior changes (A2, A3) get explicit HITL review; snapshot rebaselines only in A2 and flagged.
- Sync emitters / generated barrels: hand-edit `@generated` index exports; never `yarn sync` in a focused PR.
- Any new emitter logic gated against both modes (self-regen vs external) — the recurring trap from the template-wiring arc.
