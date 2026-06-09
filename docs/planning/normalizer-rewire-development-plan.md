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

1. Feature flag at the `stage/route.ts` seam: stub vs `ExecuteFullStagedGenerationUseCase`.
2. Golden-manifest comparison harness (N reference prompts → diff against stub output; gate per Q3: R01–R18 pass-rate must not regress).
3. Define quantitative rollback triggers **here** (error rate, p95 latency, golden regression) — deliberately absent from the scope doc until Q1 confirmed.
4. Canary window → swap default → keep flag one release as the rollback lever.

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
- **Liveness correction (for the record):** `compileAdapterUserPrompt` is consumed by the client/WebLLM path (`client-manifest-generation.use-case.ts`, wired at `wire.client.ts:320`) and the MCP server adapter — **not** stage 4, which uses `compileStage4Prompt`. Mechanism-level attributions must be traced to the import, not inferred from proximity.

## Workstream C — suspects (no investment before step-zero)

Both route through `mcp-server`; the step-zero question is the same: **is the MCP server actually served/deployed, and by whom?**

1. **C0 (shared gate):** trace `mcp-server` entrypoints to a deployment or client config. If nothing serves it, both items downgrade to "fix when MCP goes live" and exit this plan. If it **is** deployed but consumed externally rather than by this repo, P5 becomes an **API contract issue** — different owner, different urgency — not just an internal fix; record which case C0 found.
   **C0 VERDICT (2026-06-09): served internally.** `apps/tui` spawns `packages/mcp-server/dist/cli.js` over stdio (`mcp-client.service.ts`, `StdioClientTransport`). No external consumer found (no `.mcp.json`, no deploy workflow). The `hexagen-mcp` bin is a latent external surface — registrable by any MCP client — but nothing registers it today. → P4/P5 proceed as internal fixes at normal urgency, P5 first.
2. **P4** (remediation hardening: hardcoded `"gpt-4"`, no governance gate) — only if C0 passes.
3. **P5** (MCP governance parity: `validateDraft` vs R01–R18, no lint:arch/HITL gate) — only if C0 passes; this one is a governance-bypass risk, so it outranks P4.

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
