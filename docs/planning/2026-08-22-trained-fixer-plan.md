# Trained fixer — implementation plan

**Date:** 2026-08-22
**Decision record:** ADR-0067 (Proposed)
**Status:** plan only; nothing below is built

## What this is

Replace the LLM repair path for manifest violations with a small model trained
on a **synthetic** repair corpus, gated on telemetry showing it beats the
current behaviour. The deterministic fixer keeps precedence wherever it applies.

Not in scope: training a generator (rejected, ADR-0067), changing the retention
promise, or persisting user content in any form.

## The shape of the problem

```
generate ──▶ deterministic check ──▶ violations? ──▶ repair ──▶ re-check
                (arch-linter, zod)                     ▲            │
                exact oracle                           └────────────┘
```

Repair today splits three ways:

| path                    | where                                                                | covers                                             |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `applyDeterministicFix` | **browser** — `ManifestPreview.tsx:164`, `ManifestAutoFixDrawer.tsx` | ~7 violation titles in the `canAutoFix` allow-list |
| LLM repair stages       | **server** — staged pipeline                                         | everything else                                    |
| nothing                 | —                                                                    | violations neither path resolves                   |

The model targets the middle row. The first row wins wherever it applies: an
exact repair is better than a probabilistic one on every axis.

## Phases

### P0 — Stable violation codes _(prerequisite, no model)_

`canAutoFix` branches on free-text titles and substring matches
(`title === "Scope Missing"`, `desc.includes("missing ports")`). That cannot be
a telemetry dimension: it risks embedding user content, and it drifts silently
whenever a message is reworded — the same class splits in two and the metrics
lie without failing.

Introduce a bounded code set, mapped from the current titles, and key both the
allow-list and telemetry on codes. This improves the fixer on its own merits and
is worth doing whether or not a model ever ships.

**Exit:** every violation the linter emits carries a stable code; `canAutoFix`
switches on codes; no free text reaches telemetry.

### P1 — Repair telemetry _(delegated, in progress)_

`apps/web/lib/platform/repair-telemetry-store.ts`. Records violation code, which
path handled it, round counts, durations, and a terminal outcome
(`deterministic-fixed` / `llm-fixed` / `unfixable` / `abandoned`).

Metadata only — no YAML, no prompts, no outputs, no context or port names, no
paths, no repo URLs. The store lands before any call sites are wired.

**Exit:** schema + migration merged, idempotent against the live
`hexagen-monaco-quota-data` volume.

### P2 — Wire the call sites, collect a baseline

Instrument both repair surfaces. Then **wait**, because there is nothing to
compare against yet.

Two things make current numbers invalid as a baseline:

- Server-side scans fail before doing real work until D-P1 (#616) deploys.
- P0 changes how classes are counted.

**Exit:** a baseline over post-deploy traffic: convergence rate and median
rounds per violation code.

### P3 — Synthetic corpus

Mutation operators that inject known violations into **valid** manifests. The
label is the pre-mutation document, so it is correct by construction.

```
valid manifest ──mutate──▶ broken + linter output ──▶ (label: the original)
```

Seeds: the repo's own manifests, the template-engine templates, and generated
fixtures. Operators derive from the violation codes in P0, weighted toward
classes `canAutoFix` returns `false` for.

Design constraints:

- One operator per violation code, so coverage is legible and gaps are visible.
- Compose operators to produce multi-violation documents — production rarely
  presents exactly one.
- Hold out whole _seeds_, not sampled pairs, or a mutated sibling of a training
  document leaks into eval and the numbers flatter the model.
- Every generated pair is validated by actually running the linter. A pair whose
  "broken" side does not produce the intended violation is a corpus bug, not
  training data.

**Exit:** a generator producing labelled pairs across every P0 code, with
held-out seeds, and a report of which codes have no operator.

### P4 — Train and evaluate offline

Small model, distilled for the narrow task. Evaluate on held-out seeds against
the metric that matters: **does the linter pass after one repair round.**

Compare against two baselines, not one — the current LLM path, and the trivial
"no repair" floor. A model that beats nothing is not a result.

**Exit:** offline numbers per violation code, and an explicit list of classes
where the model is worse than the incumbent.

### P5 — Shadow, then gate

Run the model alongside the existing path, recording both outcomes, serving the
incumbent. Only when telemetry shows better convergence or fewer rounds on the
same codes does it take traffic — behind a default-off env switch mirroring
`BROWNFIELD_GITHUB_SCAN` (`ENABLING_VALUES = {"1","true"}`, anything else off).

**Exit:** shadow data justifying the switch, per code, or an honest decision not
to ship.

## Sequencing

```
P0 codes ──▶ P1 telemetry ──▶ P2 baseline ──▶ P3 corpus ──▶ P4 train ──▶ P5 shadow
                                   ▲
                          blocked on #616 deploy
```

P3 can start during P2 — it needs P0's codes, not the baseline.

## Decisions needed

| id      | question                                                                      | why it blocks                                                                                                                             |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **F-1** | Which surface does the model serve — browser fixer, server pipeline, or both? | They are different deployment targets. "The fixer" currently names two things.                                                            |
| **F-2** | Self-hosted small model, or a hosted fine-tune?                               | Hosted forfeits the model-swap lever ADR-0067 protects; self-hosted adds ops the single-container topology (ADR-0064/0065) does not have. |
| **F-3** | Is a _worse-but-cheaper_ fixer acceptable if the linter still gates?          | If yes, the bar is cost and latency, not convergence, and P4's metric changes.                                                            |

## Risks

| risk                                          | mitigation                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Synthetic distribution ≠ production           | P2 telemetry names codes seen in production with no operator; that list drives P3 additions.            |
| Corpus leakage inflates results               | Hold out seeds, never pairs.                                                                            |
| P0 churn invalidates the baseline             | Land P0 before P2 collection starts, not during.                                                        |
| Model regresses a class the incumbent handled | P5 shadow compares per code; adoption is per code, not global.                                          |
| Effort exceeds value                          | P0 and P1 are useful alone. If P4 disappoints, the work already bought stable codes and repair metrics. |

## What would make this not worth doing

Stated plainly so it can be checked rather than rationalised later:

- If P2 shows the LLM path already converges in one round for most classes,
  there is little headroom and the remaining work is cost optimisation (F-3).
- If most unfixed violations turn out to have exact repairs, the right answer is
  more deterministic rules, not a model.
- If production violation classes cluster in a handful of codes, hand-written
  fixes will beat a model on every axis and P3 onward should be dropped.
