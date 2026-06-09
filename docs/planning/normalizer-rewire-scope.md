# Rewire Scope — AI-manifest Stage Route → Fuller Per-Stage Pipeline

**Status:** Scoped. Not started. Implementation gated on the open questions below.
**Date:** 2026-06-09
**Parent:** The §1 gating item of [normalizer-rewire-backlog.md](./normalizer-rewire-backlog.md). All findings below are verified against current `main` (read-only investigation pass).

## Goal

Replace the live 4-LLM-pass stub that serves AI-manifest generation with the fuller per-stage pipeline (richer prompts + R16–R18 quality + adversarial validation), so generated manifests improve in quality. This is the item that converts the already-merged groundwork (`architecture-contract.ts` token sets, `PLANE_NAMES`) into user-visible value.

## Current state (verified)

Both implementations target the same 7-stage contract — `PipelineState`:
`stage0 NormalizedPrompt → stage1 DomainAnalysis → stage2 ClassificationResult → stage3 PortMap → stage4 AdapterBindings → stage5 AssembledManifest → stage6 ValidationReport`.

| Stage               | Live NL stub (`ExecuteStagedGenerationUseCase`)     | Per-stage target                                                                     |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0 normalize         | "workspace architect" inline → `{name,description}` | `ExecutePromptNormalizationUseCase` (rich)                                           |
| 1 domain extraction | **skipped**                                         | `ExecuteDomainExtractionUseCase`                                                     |
| 2 classification    | "context-list" inline → accepted only               | `ExecuteContextClassificationUseCase` (accept/reject/uncertain + banned-name filter) |
| 3 ports             | "ports" inline                                      | `ExecutePortMappingUseCase` (R16–R18, forAggregate)                                  |
| 4 adapters          | "adapters" inline                                   | `ExecuteAdapterAssignmentUseCase`                                                    |
| 5 assemble          | reuses `ExecuteManifestAssemblyUseCase`             | same (pure TS — shared join point)                                                   |
| 6 validation        | **skipped entirely**                                | `ExecuteValidationReviewUseCase` (adversarial R01–R18 linter)                        |

The stub (`ExecuteStagedGenerationUseCase`) is a 4-LLM-pass compression that drops domain extraction, rich classification, port-quality enforcement, and the entire validation stage.

**Key enabler:** stages 3–6 of the target are **already wired and live** in `ExecuteStructuredConfigGenerationUseCase` (the import path). It constructs the four stage-3..6 use-cases and threads `onStageTelemetry` into each. Its callback surface is `StructuredConfigGenerationCallbacks` — `onProgress(stage, durationMs)` / `onError` / `onChunk` / `onStageTelemetry`; the spec route adapts `onProgress` into `stage-start` (`durationMs === 0`) vs `stage-complete` stream events. It does **not** construct the per-stage 0–2 LLM use-cases — instead it synthesizes the stage 0–2 `PipelineState` outputs deterministically from the structured input (parse → `NormalizedPrompt`; builders → `DomainAnalysis` / `ClassificationResult`; optional `ClassifyContextTypeUseCase` LLM pass for low-confidence types), because structured input already carries the domain. **This is the working blueprint** — it populates every stage slot of the contract; the NL rewire swaps the deterministic 0–2 builders for the LLM use-cases.

**The route seam:** `apps/web/app/api/manifest/generate/stage/route.ts` constructs `new ExecuteStagedGenerationUseCase(llm, txManager)` and streams via `StagedGenerationCallbacks`. Swapping the constructed orchestrator + preserving the callback/streaming contract is the cutover point.

## The gap

Only the stage **0–2** LLM use-cases (`ExecutePromptNormalizationUseCase`, `ExecuteDomainExtractionUseCase`, `ExecuteContextClassificationUseCase`) are implemented but not instantiated in any production entrypoint. The rewire chains them ahead of the proven 3–6 chain.

## Migration strategy (recommended)

Build a new **`ExecuteFullStagedGenerationUseCase`** chaining 0→6 using the existing per-stage classes and the structured-config callback-adaptation pattern. Keep `ExecuteStructuredConfigGenerationUseCase` as the "skip 0–2" sibling (both share the same stage 3–6 instances). Swap the route from the stub to the new orchestrator, validate, then delete the stub.

Rejected alternative: bolt 0–2 onto the structured-config use-case — conflates two entry modes into one branchy class.

## Where the parked work lands

- **T2b / P2** (banked groundwork): `architectureContext` injection into stage 0 becomes live-relevant the moment `ExecutePromptNormalizationUseCase` is wired — this rewire is its consumer.
- **Reconciliation (backlog §3):** once stage 2 (deterministic filter) AND stage 6 (R01) are both live, all three context-name ban lists are live → the `stripe-payments` / `api-gateway` / `user-database` contradictions become real. Must reconcile as part of this, not after.
- **Manifest enumeration:** the per-stage use-cases become live → they then belong in `context.yaml`'s `use_cases` (the CodeRabbit finding declined on the groundwork PR becomes actionable here).
- **P6** (dead `escalationConfig`): becomes live; verify per-stage timeout/escalation coverage.

## Risks

1. **Cost/latency:** 4 passes → ~6 LLM passes (0,1,2,3,4,6 LLM; 5 is TS). More latency, spend, failure surface. Confirm the #257/#258 tiered-timeout + fail-fast pattern covers the 0–2 use-cases.
2. **Behavior/quality change:** richer output is _different_ output. Needs golden-manifest comparison + a human quality bar before cutover.
3. **New LLM variability:** stage 1 (domain extraction) and full stage 2 (accept/reject/uncertain) are behaviors the stub never ran.
4. **Streaming contract:** new orchestrator must adapt per-stage callbacks to the route's stream — blueprint exists.

## Proposed phasing

- **P1 — Orchestrator:** build `ExecuteFullStagedGenerationUseCase` (0→6), wire T2b stage-0 grounding, confirm per-stage timeouts/escalation, unit + integration tests. Not yet routed.
- **P2 — Reconciliation:** the deferred §3 ban-list fix (all sites now live), with the three contradiction cases as failing-then-passing tests.
- **P3 — Cutover:** behind a feature flag on the route; golden-output validation + canary; swap default. Rollback = flip the flag back (generation is per-request and stateless — no in-flight state to migrate); quantitative rollback triggers (error rate, p95 latency, golden-output regression) get defined when P3 is planned, since they depend on the answer to open question 1.
- **P4 — Cleanup:** delete the stub, add the now-live use-cases to `context.yaml`, update docs/backlog.

## Open questions (gate implementation)

1. **Cutover risk appetite** — feature-flag + canary (recommended), or straight swap?
2. **Local/WebLLM path** (`ClientManifestGenerationUseCase`, separate phases) — in scope, or defer to a follow-on?
3. **Quality bar** — what gates cutover: golden manifests, human eval, R01–R18 pass-rate on generated output, or a combination?

## Methodology note

Every claim here was verified against current code, per the step-zero rule in [normalizer-rewire-backlog.md](./normalizer-rewire-backlog.md) §4 (`feedback_verify_codepath_live`). The prior arc's central error was treating prompt text as a production concern without confirming the path was live; this scope explicitly maps live-vs-wired before proposing any change.
