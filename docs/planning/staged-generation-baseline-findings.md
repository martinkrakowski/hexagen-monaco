# Staged-Generation Baseline Findings (A3 §4 canary prep)

**Date:** 2026-06-10
**Parent:** [normalizer-rewire-development-plan.md](./normalizer-rewire-development-plan.md) (A3) · [staged-generation-canary-runbook.md](./staged-generation-canary-runbook.md)
**Harness:** `yarn workspace @hexagen/agentic-interaction golden-harness` (PR #289) — 8 golden prompts × {stub, full} × rollback gates T1–T4.

Three baseline runs were executed against the real OpenRouter provider chain
(`apps/web/.env.local` mirrors prod's `LLM_API_KEY`/`LLM_BASE_URL`; `LLM_MODEL`
overridden per run as a process env var — no secret, file, or prod change).
Each run falsified a different assumption. This document is the canonical
record; the runbook's preconditions 4 and 5 derive from it.

## Run summary

| Run | Model                                | T1  | T2  | T3  | T4  | Verdict                                                        |
| --- | ------------------------------------ | --- | --- | --- | --- | -------------------------------------------------------------- |
| 1   | `z-ai/glm-5.1` (prod's actual model) | ❌  | —   | —   | —   | Full pipeline 0% success — reasoning model truncation (F1)     |
| 2   | `openai/gpt-4o-mini`                 | ✅  | ✅  | ✅  | ✅  | **Gates green, baseline rejected** — weak-model artifacts (F2) |
| 3   | `openai/gpt-4o`                      | ✅  | ❌  | ✅  | ✅  | T2 structurally red (F5); quality picture reframed (F3, F4)    |

## F1 — Reasoning models zero the full pipeline (run 1)

The full pipeline's short-output stages (0/1/2/6) cap `maxTokens` at 800
(`classifyContextType` 256). On a reasoning model the invisible reasoning is
billed as completion tokens and consumes the entire budget:
`finishReason: "length"`, `completionTokens: 800`, empty content → "No valid
NDJSON lines" → 0% full-pipeline success. The stub's 2000-token passes keep
fitting, which is why prod's stub works on glm-5.1 today.

Probe-proven: the identical stage-0 request without the architecture context
emitted perfect NDJSON; with `buildGreenfieldArchitectureContext()` the longer
prompt pushed reasoning over the cap → empty.

**Disposition:** runbook precondition 4; A4 "reasoning-model hardening"
(OpenRouter `reasoning` controls and/or `finishReason === "length"`-aware
retry with a raised cap).

## F2 — Green gates ≠ green baseline: weak-model artifacts (run 2)

All gates passed on `gpt-4o-mini` while the output was degenerate in two ways
the gates structurally cannot see:

- **Stage-1 under-decomposition.** Domain analysis returned a single subdomain
  (`['E-commerce']`) for the 8-concern ecommerce prompt → 1-context manifests
  (full 1–2 ctx vs stub 4–7). Stage 2 rejected nothing — the collapse happens
  at stage 1, and T4 only catches _zero_ contexts.
- **Stage-6 judge exemplar parroting.** The judge copied the prompt's
  `postgres-repo` few-shot: `R01 … technology noun 'Postgres'` reported
  against every context name in every run (e.g. `book-collection-manager`),
  plus fabricated "marked as shared-kernel" claims. Judge pass-rate 0% on both
  pipelines → T3's "not regressed" clause compares 0% ≥ 0% and is vacuous.

**Disposition:** runbook precondition 5 (spot-check both artifacts on any
green run); A4 "weak-model hardening".

## F3 — The universal judge-fail is a Stage-6 _input_ defect, not a model defect (run 3, decisive)

On `gpt-4o` the judge verdicts became differentiated (varied rules, varied
counts) but still failed 16/16. Probe + code inspection found the root cause:

`compileStage6Prompt` receives only
`Pick<PipelineState, "stage0" | "stage2" | "stage5" | "contextMappings">`.
The judge therefore sees the **assembled YAML only**, where
`draftToManifest` renders ports as _name-only string lists_ under
`layers.application.ports.{in,out}` and adapters as _bare name strings_ under
`layers.infrastructure.adapters` — there is **no `implements` field and no
port-type information in the judge's input at all**. But the rule text orders
checks the input cannot support:

- R02/R03 reference `ports.in` / `ports.out` entries with types;
- R04/R05/R06 require verifying which adapter lists a port in `implements`.

Even a perfect judge must improvise; gpt-4o confabulated ("no inbound ports
defined" × every context) and both pipelines fail universally **on any
model**. Separately, the judge misapplies R01 (a _context-name_ rule) to
adapter names (`PostgresBookCollectionRepoAdapter` — vendor nouns are
legitimate in adapter names) and labels ordinary domain words (`catalog`,
`profile`, `search`, `engine`) "technology nouns".

Stage 6 also serves the **live import path** (structured-config pipeline), so
this defect ships to users today as bogus advisory validation errors
(`passed: false` does not fail the request — Stage 6 is advisory).

**Disposition:** fix immediately (before re-baselining): feed stage 3 (port
definitions with types) and stage 4 (adapter `implements` bindings) into
`compileStage6Prompt`, align the rule text with the data actually provided,
and compute R01 deterministically via `isBannedContextName` instead of asking
the LLM. T3 cannot be meaningful until this lands.

## F4 — The stub leaks banned names; the full pipeline doesn't (run 3)

Ecommerce stub output contained context `payment-gateway` (banned token
`gateway`), caught by the deterministic `isBannedContextName` check in the
harness metrics. T3 only audits _full_-pipeline output, so no gate tripped —
but it is direct evidence the A2 deterministic filter (wired into the full
pipeline only) prevents a leak class the stub ships today. The full pipeline
was clean on all 8 prompts including the saas-billing Stripe bait.

## F5 — T2 latency is structurally red, not incidentally (run 3)

Full pipeline: mean 23.6 s, p95 38.8 s. Stub: mean 6.9 s, p95 9.5 s →
ratios 3.4× / 4.1× against a 2× gate. The full pipeline is ~7 sequential LLM
calls vs the stub's 4 short passes; run 2 "passed" T2 by 123 ms (1.99×),
i.e. the 2× calibration was always borderline. The stub is partly fast
_because it generates less and worse_ (see F2/F4 — and on `minimal-books`,
"an app for managing my book collection", the stub fabricated 8 contexts
including `analytics`/`notifications`/`recommendation-engine`, while the full
pipeline's single `personal-library-management` context is the faithful DDD
answer; run 3's lower full-pipeline context counts are predominantly prompt
fidelity, not under-decomposition).

**Disposition:** recalibration decision pending (HITL): absolute p95 ceiling
(~45 s, defensible for a streaming-progress UI) vs 4× relative. The gate was
plan-approved at 2×, so changing it requires explicit sign-off.

## Next steps (agreed 2026-06-10)

1. **Stage-6 judge fix** (F3) — separate PR, tests-first (touches the live
   import path).
2. **T2 recalibration** — user decision pending.
3. **Re-baseline on `openai/gpt-4o`** once 1 (and 2) land.
4. **Model comparison runs** (user request): baseline NVIDIA
   Nemotron 3 Super 120B and the Hunyuan "Hy3" preview model via OpenRouter
   once the judge fix lands, so T3 is meaningful for the comparison.
5. **Prod swap decision** (`gh secret set LLM_MODEL` + deploy) — explicit
   user go-ahead required; nothing changed so far.
