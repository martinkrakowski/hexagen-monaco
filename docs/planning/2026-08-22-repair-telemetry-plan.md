# Repair telemetry — implementation plan

**Date:** 2026-08-22
**Decision record:** ADR-0067 (Proposed)
**Scope:** measurement only. No model, no training, no corpus.

## Why this exists on its own

ADR-0067 accepts a trained fixer in principle but gates it on evidence. There is
currently none: nothing records how often repair succeeds, how many rounds it
takes, or which violation classes dominate. Every argument for or against
building a model is therefore unfalsifiable.

This plan builds only the measurement. It is worth landing whether or not a
model is ever trained, for two reasons that stand alone:

- **Stable violation codes fix a live defect** (P0 below). Today's titles cannot
  be used as a telemetry dimension at all.
- **A repair baseline is a product metric**, not just ML groundwork. "How often
  does generation produce something we cannot repair" is worth knowing
  regardless.

The expected outcome is worth stating up front so it can be checked rather than
rationalised later: **the most likely finding is that residual violations have
exact repairs and the correct answer is more deterministic rules, not a model.**
This plan is designed to make that outcome visible rather than to justify the
model.

## P0 — Stable violation codes

**This is a prerequisite, not a nicety. Telemetry cannot ship before it.**

`ValidationItem` is `{ status, title, description, contextName? }`
(`packages/manifest-generation/src/domain/model/manifest-view-data.ts:40`), and
titles are built two ways:

```ts
// static
title: "Scope Missing";
title: "Architecture Missing";
title: "Minimum Interface Contract";
title: "Invalid YAML";

// interpolated — carries USER DATA
title: `${name}: ${unconnected.length} Unconnected Ports`;
title: `${name}: Zero Adapters`;
title: `Context Name "${name}"`;
```

Two independent blockers, either sufficient on its own:

1. **Privacy.** `${name}` is the user's bounded-context name. Persisting a raw
   title stores user architecture, which contradicts the retention promise
   ADR-0067 records (four places in shipped copy). A telemetry table full of
   `payments: 3 Unconnected Ports` is a leak, not a metric.
2. **Cardinality.** Interpolated titles are unbounded — one distinct value per
   context name per count. As a dimension they never aggregate; every row is
   unique and the table answers nothing.

There is also a correctness wart worth removing while here: `canAutoFix` matches
these with `title.includes("Zero Adapters")` and `title.includes("Context Name")`,
i.e. substring tests against strings containing user input.

### Work

- Add a bounded `ViolationCode` union covering every emitted violation. Derived
  from the emit sites, not invented.
- Emit the code alongside the existing `title`/`description`. The human-readable
  fields stay for the UI; the code is what machines key on.
- Switch `canAutoFix` and `applyDeterministicFix` to branch on codes rather than
  substrings.
- Exhaustiveness-check the mapping so a new violation cannot be added without a
  code — mirror the `QUOTA_LIMITS`-derived-`KINDS` idiom in `quota-store.ts`,
  which exists because a hand-maintained parallel list silently drifts.

**Exit:** every violation carries a code; no free text reaches telemetry; a new
violation without a code fails to compile.

**Risk:** this touches the client-side fixer consumed by `ManifestPreview.tsx`
and `ManifestAutoFixDrawer.tsx`. Behaviour must not change — same violations
fixable, same output. Characterisation tests over the current `canAutoFix`
matrix before the refactor, not after.

## P1 — The store _(delegated, in progress)_

`apps/web/lib/platform/repair-telemetry-store.ts`, matching the idiom of
`run-history-store.ts` (`*Input` / `*Record` / internal `*Row` / repository
interface).

Records, per repair attempt: violation code, which path handled it
(`deterministic` / `llm` / `none`), round index, duration, and a terminal
outcome (`deterministic-fixed` / `llm-fixed` / `unfixable` / `abandoned`).

**Persists no user content.** No YAML, no prompts, no outputs, no context or
port names, no file paths, no repo URLs, no error text that could embed them.
Every field must survive the question _could this reconstruct any part of a
user's architecture_ — including in aggregate, since a sufficiently unusual
combination of counts is itself identifying.

Migration is forward-only and idempotent; there is a live production volume
(`hexagen-monaco-quota-data`) that must survive the upgrade.

**Exit:** store and migration merged, no call sites wired.

## P2 — Wire and collect

Instrument both repair surfaces — the browser fixer and the server pipeline —
then wait.

### Do not collect a baseline before these two land

- **#616 must deploy.** Server-side scans currently fail before doing real work
  (`findMonorepoRoot` throws; the linter is unreachable), so today's numbers
  measure a broken path.
- **P0 must be complete.** Codes change how classes are counted, so a baseline
  spanning the change is two incomparable halves.

### What the baseline must answer

| question                                           | why it matters                                               |
| -------------------------------------------------- | ------------------------------------------------------------ |
| convergence rate per code                          | is there headroom at all                                     |
| median and p90 rounds per code                     | distinguishes "hard" from "slow"                             |
| share handled deterministically                    | how much the allow-list already covers                       |
| which codes reach `unfixable`                      | the model's actual target set                                |
| codes appearing in production but not in the fixer | candidates for a new deterministic rule — the cheaper answer |

**Exit:** a written baseline over post-deploy traffic, per code.

## Sequencing

```
P0 codes ─────▶ P1 store ─────▶ P2 wire ─────▶ baseline ─────▶ decide
                                    ▲
                           blocked on #616 deploy
```

P1's schema can be authored against P0's code union before P0 merges, but must
not ship keyed on titles.

## Decisions needed

| id      | question                                                                          | default if unanswered                                                               |
| ------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **T-1** | Does the browser fixer report telemetry, or server only?                          | Server only — the client path would need an endpoint and consent.                   |
| **T-2** | Retention window for telemetry rows?                                              | 90 days, matching nothing in particular; needs a real answer.                       |
| **T-3** | Is per-attempt grain needed, or is per-run enough?                                | Per-attempt — round counts are the metric that matters.                             |
| **T-4** | Does an anonymous session id go on the row, or nothing linking rows to a session? | Nothing. Aggregate-only is the safer default and still answers the questions above. |

T-4 matters more than it looks: a session id makes rows correlatable, which
turns a metadata table into a behavioural record. Absent a question that needs
it, it should not be there.

## What this plan deliberately does not do

- No corpus, no training, no model. ADR-0067 P3+ is out of scope.
- No change to the retention promise. If a future question genuinely requires
  user content, that needs its own ADR and a copy change.
- No new deterministic fix rules. Tempting while in P0, but it would change the
  behaviour the baseline is meant to measure. Rules land after the baseline, so
  their effect is visible.

## Risks

| risk                                         | mitigation                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 changes fixer behaviour                   | Characterisation tests over the current matrix before refactoring.                                                                                                       |
| Telemetry accretes user content over time    | Every field justified against the reconstruction test at review; no free-text column exists to abuse.                                                                    |
| Baseline collected over a broken path        | Gate collection on #616 deploying; record the deploy commit alongside the baseline.                                                                                      |
| Low traffic makes the baseline uninformative | Free tier is 10 generations/day. If volume is too low to conclude anything, that is itself the answer — and an argument against the model, not for more instrumentation. |
