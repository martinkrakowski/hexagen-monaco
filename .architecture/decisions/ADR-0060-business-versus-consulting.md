# ADR-0060: Business Versus Consulting

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Product
**Runbook ID:** D-3
**Relates to:** ADR-0059 (D-0 calendar), ADR-0061 (D-1 license split — this decision is a prerequisite), [`2026-08-17-fde-gtm-development-runbook.md`](../../docs/planning/2026-08-17-fde-gtm-development-runbook.md) Phase −1 D-3, [`2026-08-17-positioning-plan-independent-review.md`](../../docs/planning/2026-08-17-positioning-plan-independent-review.md) §8

> Numbering note: Phase −1 batch, contiguous after ADR-0059. The historical ADR-0009/0010 numbering collisions are not reused.

## Context

D-1 (license split) is not free-standing. Fair-source on the wedge is the _business_ answer: it creates a bottom-up funnel that can become a hosted paid platform. The coherent _consulting_ answer is different and simpler: keep everything proprietary and issue a one-page commercial grant (engagement + post-engagement CI use) to paying clients — no npm-license work, no conversion clock, a smaller funnel.

The independent review (§8) under-steelmanned the consulting path. Both answers are coherent for a paid product. Choosing after writing LICENSE files, or choosing by whichever D-1 option is cheaper to type, would invert the dependency: D-3 decides the motion, D-1 implements it.

The founder is a solo operator with a working conformance engine, a published generator, and no inference product. The question is intent, not inventory.

## Decision

**Business.** The motion is an FSL wedge plus a hosted paid platform. This is not a consulting-only practice.

Concretely:

- The public distribution surface (linter, `packages/sync`, future adopt / bootstrap / report, CI action) exists to be installed without a sales call.
- Revenue is the hosted platform (history, dashboards, multi-repo, agent-constraint pack) and, later, billed engagements that ride the same wedge. Consulting is a channel, not the company.
- D-1 therefore applies the three-layer fair-source structure (ADR-0061). The proprietary-plus-engagement-grant alternative is rejected, not deferred.

Rejected alternative:

- **Consulting-only.** Legally simpler, and it would still sell. It forecloses the bottom-up funnel the runbook is built around, and it would make Phase 1.2 (the public CI action) a cost with no distribution thesis. If Phase 0's kill criterion fires (the verdict only lands on Hexagen-generated code), the fallback _to_ a consulting configuration is still available — that fallback is a later amendment, not this decision.

## Consequences

- Phase 1.2 (published CI action) is in scope once Phase 0's gate passes. Under a consulting-only answer it would not be.
- Phase 2 (accounts, persistence, billing) remains gated on Phase 1 _and_ on this decision. This ADR is that gate: it is already "business".
- License, README, and publish-pipeline work in ADR-0061 / ADR-0062 is justified by this intent. It is not optional packaging.
- A future flip to consulting-only is an amendment of this ADR, not a silent narrowing of D-1.
