# Mercury-2 Provider Swap — Investigation Summary

**Date:** 2026-06-10
**Scope:** Item 5 of the staged-generation arc — swapping the production
staged-generation provider chain to Inception Labs `mercury-2`.
**Status:** Measurement closed. PR stack #294–#298 decision-ready; swap gated
on merge + explicit deploy sign-off.

---

## 1. Background

The cloud "Generate manifest" path runs a 7-stage pipeline
(`ExecuteFullStagedGenerationUseCase`) plus a 4-pass stub baseline. A
6-model golden-harness sweep (8 prompts × stub/full, gates T1–T4) was run to
pick the production model:

| Model                             | Full success | Full p95             | Notes                                                                                                                               |
| --------------------------------- | ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| gpt-4o (incumbent)                | 100%         | 42.9s                | normal decomposition                                                                                                                |
| claude-3.5-haiku                  | 100%         | 99.7s                | mild decomposition loss                                                                                                             |
| tencent/hy3-preview               | 100%         | 215.4s               | collapsed 4/8                                                                                                                       |
| nvidia/nemotron-3-super           | 75%          | 182.2s               | NDJSON format failures                                                                                                              |
| mercury-2 @instant                | 62.5%        | 10.2s                | stage-2 NDJSON failures                                                                                                             |
| **mercury-2 @low**                | **100%**     | **11.8s**            | first-ever full-pipeline judge pass                                                                                                 |
| nemotron-3-ultra-550b (post-#298) | 100%         | **518.4s — T2 fail** | best decomposition of any model (median 6 ctx, zero collapse); latency degrades monotonically through the run (provider throttling) |

Mercury-2@low was the clear latency winner (~3.5× faster than gpt-4o) with
clean format adherence — but post-wiring validation exposed a quality
regression that turned the swap runbook into an investigation.

## 2. The problem

On the integrated branch (#295+#296+#297), all gates T1–T4 passed — yet
**6/8 full-pipeline runs collapsed to a single bounded context** (e.g. an
entire e-commerce platform modeled as one "Blog Management"-style context).
The gates were blind to it: T4 only catches _zero_-context output. This was
the blocker for the swap: latency parity is worthless if the architecture
degenerates.

## 3. Root cause analysis

A stage-level state-dump probe located the collapse at **Stage 1 (domain
extraction)**: mercury emitted one `subdomain` NDJSON line; Stage 2 then
correctly consolidated the single candidate; Stage 3 rendered one context.
Three compounding causes, plus several non-causes that were explicitly
ruled out:

### Cause A — the prompt never asked for decomposition

The Stage-1 system prompt described subdomain lines as _"zero or more …
(backward compatibility)"_. gpt-4o decomposes anyway from its priors;
mercury-2 takes the instruction literally and satisfies it with one line.
**Fix:** an explicit DECOMPOSITION REQUIREMENT block (one subdomain per
business capability, 3–6 typical, anti-merge example). A/B probe at low
effort: blog 1→2, fleet 1→4, saas 1→3 subdomains, at ~1s latency.

### Cause B — token budget truncated compliant output

Stage-1 `maxTokens` was 800. A _correct_ multi-subdomain answer (subdomains
plus aggregates, use cases, and events) hits `finish=length` at 800,
truncating later subdomains' building blocks. Mercury also bills reasoning
tokens against `max_tokens` (medium effort at the 800 cap → empty content →
`StageMaxRetriesError`). **Fix:** maxTokens 800→1600.

### Cause C — declared vs implied subdomain disjointness

Collapsed outputs still carried the **full decomposition** on the
`aggregateRoot.subdomain` / `useCase.subdomain` fields — probes showed 1
declared subdomain line vs 4 distinct implied subdomains, and the declared
one could be _disjoint_ from the implied set. The information was never
missing, only under-declared. **Fix:** deterministic union recovery in the
parser (declared ∪ implied, declared first, encounter order, exact-string
dedupe). Provider-neutral, zero retry cost.

### Ruled out (each with measurement)

- **Reasoning effort** — effort matrix on Stage 1's exact prompt: low→1,
  medium→1, high→2 subdomains at 5× latency. Post-prompt-fix A/B (2 repeats):
  medium is a coin-flip per prompt at 2–3× latency. Variance dominates
  effort; coarse decomposition is a capability trait, not a budget artifact.
- **Temperature** — mercury's range is [0.5, 1]; sub-range values are
  silently coerced to **0.75** (curl-verified). "Lower the temperature to
  0.2" is impossible on this API.
- **Few-shot exemplar anchoring** — hypothesis: the prompt's example block
  shows exactly one `{"type":"subdomain"}` line. A/B probe (1 vs 3 exemplar
  lines, 3 repeats × 2 prompts): baseline 5/6 good, fewshot 4/6. No signal.
- **Structured-output schema** — the NDJSON `json_schema` (#295) fixed
  _format_ adherence only; an earlier "schema fixes decomposition" read was
  an artifact of a stage-2 probe with 8 candidates already fed in.
- **Sampling/penalty levers** — stop sentinels (truncation risk on a single
  JSON object, no upside), presence/frequency/repetition penalties
  (penalize the _required_ repetition of `"type":"subdomain"` structural
  tokens — actively anti-decomposition), logit_bias (requires token IDs
  Inception doesn't publish), per-line max_output_tokens (parameter does
  not exist).

### Probe-methodology findings (recorded for future investigations)

- Mercury-2 **confabulates its own API** (claimed `reasoning_effort`
  unsupported; proposed a nonexistent "full" value; advised temperature 0.2).
  Only curl probes against the live API are trustworthy.
- A single-object `json_schema` silently truncates NDJSON output to ONE
  object; probes must use the real array-wrapped `STAGE1_NDJSON_LINE_SCHEMA`.
- Schema property richness is load-bearing: a loose `{type}` items schema
  collapsed all probe outputs and nearly produced a wrong conclusion about
  reasoning effort.

## 4. Fixes shipped (PR stack #294–#298)

| PR      | Content                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #294    | Qwen3 catalog refresh with thinking-disable gate (F1: reasoning bills against max_tokens)                                                                                                                                                                                                                                                                         |
| #295    | Inception (Mercury) provider option; client-side temperature clamp; NDJSON line schemas via `response_format: json_schema`                                                                                                                                                                                                                                        |
| #296    | Harness T2 gate: absolute 45s latency ceiling alongside the 2×-stub relative bound                                                                                                                                                                                                                                                                                |
| #297    | A4 pull-forward: discard LLM judge claims for deterministic rules R01/R16/R17/R18 (recomputed programmatically); judge-grounding port-name normalization                                                                                                                                                                                                          |
| #298 c1 | DECOMPOSITION REQUIREMENT prompt block + Stage-1 maxTokens 800→1600 (Causes A+B)                                                                                                                                                                                                                                                                                  |
| #298 c2 | Subdomain union recovery: declared ∪ implied (Cause C)                                                                                                                                                                                                                                                                                                            |
| #298 c3 | Collapse soft-retry: if <2 subdomains survive recovery while the output carries ≥3 aggregates or ≥4 use cases, re-prompt with a decomposition nudge through the existing retry budget; the collapsed result is kept as a fallback and accepted if retries exhaust or later attempts fail (a collapsed manifest can still be coherent — one passed Stage-6 review) |

## 5. Validation runs

Full-pipeline context counts across the fix arc (mercury-2@low):

| prompt                  | baseline | + prompt fix | + union recovery |
| ----------------------- | -------- | ------------ | ---------------- |
| ecommerce               | 3        | 1            | 1                |
| blog                    | 1        | 2            | 3                |
| fleet-logistics         | 1        | 2            | 4                |
| healthcare-appointments | 1        | 4            | 4                |
| banking-ledger          | 1        | 4            | 2                |
| iot-telemetry           | 3        | 2            | 4                |
| saas-billing            | 1        | 1            | 2                |
| minimal-books           | 1        | 2            | 2                |
| **1-ctx collapse**      | **6/8**  | **2/8**      | **1/8**          |
| median ctx              | 1        | 2            | 2.5              |
| full p95                | 11.0s    | 10.4s        | 12.6s            |

**De-noising run** (repeat=3, 48 runs, judge pinned to an independent
gpt-4o via OpenRouter — all earlier mercury runs were mercury-judged):

- Gates T1–T4 all pass; full success 24/24; p95 12.1s.
- **Judge: full 3/24 (12.5%) vs stub 0/24** — the full pipeline is strictly
  better than the stub under an independent judge; the stub never passes.
- **1-ctx collapse 1/24 (~4%)**; median context count 3 (gpt-4o pipeline:
  3–5). The repeat=1 residual was sampling variance.
- Failing rules are generic quality rules (R10 17×, R06 10×, R09 7×) plus
  recomputed programmatic R17s — not mercury-specific defects. The Stage-6
  judge is harsh for every model (gpt-4o's own full runs scored 0% in the
  sweep).
- Notable: the single collapsed run **passed** the judge — collapse is a
  quality degradation, not invalidity, which is why c3's retry is soft.

**Commit-3 validation run** (repeat=2, gpt-4o judge, soft-retry live, 32
runs): all gates pass — full success 16/16, p95 14.5s, median 3 contexts,
1-ctx 1/16 (the benign signature: a small 3-port ecommerce manifest that
passed the judge), judge full 1/16 vs stub 0/16.

## 6. Final / expected outcome

|                        | gpt-4o (incumbent) | mercury-2@low (post-fixes) |
| ---------------------- | ------------------ | -------------------------- |
| success                | 100%               | 100% (24/24)               |
| p95 latency            | 42.9s              | **12.1s (~3.5× faster)**   |
| median contexts        | 3–5                | 3                          |
| 1-ctx collapse         | rare               | ~4%, soft-retried since c3 |
| independent-judge pass | 0% (sweep)         | 12.5% full vs 0% stub      |
| banned context names   | 0                  | 0                          |

**Conclusion:** mercury-2@low is at effective quality parity with the
incumbent at roughly a third of the latency, with the decomposition failure
mode structurally fixed (prompt), deterministically recovered (union), and
defensively retried (soft-retry). Remaining steps, in order:

1. Merge #294 → #298 (check stacked-PR base branches before merging;
   `delete_branch_on_merge` is on).
2. Prod swap: set Inception secrets + `LLM_REASONING=low`, then
   `gh workflow run deploy.yml --ref main` — both only with explicit
   sign-off.
3. Post-swap watch: known buy-backs for the residual ~4% collapse, if it
   ever matters in production, are best-of-N on subdomain count or the
   Ultra escalation seam (§7).

## 7. Addendum — Nemotron-3 Ultra evaluation (same day)

`nvidia/nemotron-3-ultra-550b-a55b` (550B/55B MoE, Mamba-hybrid, released
2026-06-04) was evaluated with the same probe-first methodology. The paid
OpenRouter endpoint was used throughout — the free tier's
`supported_parameters` omit `response_format`/`structured_outputs` entirely.

**Gate probes:**

- _Token budget (Cause B)_: reasoning bills against `max_tokens` (511 of an
  800 cap consumed → truncation) — same trap as mercury — but OpenRouter's
  `reasoning: {enabled: false}` cleanly zeroes it, and the pipeline's
  `LLM_REASONING=disabled` path already sends that. Ultra is verbose (33–60
  NDJSON lines vs mercury's ~dozen); stage 1's 1600 cap is necessary and
  sufficient.
- _Format (Super's failure mode)_: absent — 14/14 probe calls produced
  100%-valid NDJSON, all `finish=stop`. (Schema-enforced `response_format`
  is broken on the paid endpoint: `finish=length`, zero parsed lines — moot
  for the pipeline, which doesn't send it through the OpenRouter entry.)
- _Decomposition priors_: gpt-4o-class — 3/4 golden prompts decompose
  WITHOUT the #298 prompt block (mercury's equivalent baseline: collapse on
  6/8); the block fixes the fourth.

**Full harness** (repeat=1, gpt-4o judge, post-#298): T1/T3/T4 pass; **T2
fails by 2.8×** — full p95 518.4s. Contexts 5–10 (median 6, zero collapse —
best of any model), but latency degrades monotonically through the run
(stub 11→94s, full 93→518s: provider-side throttling compounding intrinsic
slowness), and its rich manifests still scored 0/8 on the judge.

**Cascade probe** (mercury stage-1 draft → draft appended to the prompt →
Ultra refine, all 8 golden prompts):

| prompt                  | mercury union | cascade union | refine cost |
| ----------------------- | ------------- | ------------- | ----------- |
| blog                    | 2             | 3             | +24.8s      |
| ecommerce               | 4             | 5             | +35.6s      |
| fleet-logistics         | 4             | 4             | +22.6s      |
| saas-billing            | 1             | 4             | +51.0s      |
| healthcare-appointments | 2             | 5             | +27.5s      |
| banking-ledger          | 4             | 4             | +14.6s      |
| iot-telemetry           | 2             | 5             | +29.2s      |
| minimal-books           | 3             | 3             | +14.3s      |
| **median**              | **2.5**       | **4**         | **~25s**    |

Mechanically clean (8/8 valid NDJSON in refine mode) and the deltas are
real — but concentrated exactly where the draft is thin: +3 on collapsed/
2-union drafts, +0 wherever the draft already has 3–4 subdomains. Ultra is
a _collapse rescuer_, not a general enricher. As a default second hop the
cascade prices every generation at 25–60s — gpt-4o-incumbent territory —
for context richness the Stage-6 judge has never rewarded.

**Disposition:** rejected as a default stage; recorded as the designed
fallback. If single-context manifests become a real production complaint,
the shape is a stage-1 escalation (à la stage 3's `escalationConfig`):
fire Ultra-refine only when the #298 soft-retry still leaves <2 subdomains
(~4% tail, currently benign and judge-passing).
