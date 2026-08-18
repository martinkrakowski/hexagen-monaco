# ADR-0063: Quota Metering Disposition

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Product
**Runbook ID:** quota-D2
**Relates to:** [`docs/planning/llm-execution-and-free-tier-overhaul.md`](../../docs/planning/llm-execution-and-free-tier-overhaul.md) lines 207–213 (the closeout); ADR-0046 (parenthetical only — not the decision record); [`2026-08-17-fde-gtm-development-runbook.md`](../../docs/planning/2026-08-17-fde-gtm-development-runbook.md) Phase 0.4 / quota-D2

> Numbering note: Phase −1 batch. The historical ADR-0009/0010 numbering collisions are not reused.
>
> Naming: **quota-D2** (this ADR) ≠ runbook **D-2** (README, ADR-0062) ≠ architecture-remediation **D2** (BYOK persistence). Always qualify.

## Context

Two prior drafts of the positioning runbook each reversed a closed product decision in opposite directions.

The facts, re-verified in the independent review (claim 5 / N2) and adjudicated in §8:

- Five generate routes meter unconditionally. `extract-decisions` and chat correctly gate on session. BYOK is never metered (BYOK exists only on chat and returns before the quota check).
- The spec→convert double-charge (a loose-spec import burns 2 of 10 daily generation credits) was flagged in PR #337, recorded as decision D2 on 2026-07-25, and formally closed **"leave as-is"** on 2026-08-13 in `docs/planning/llm-execution-and-free-tier-overhaul.md:207-213`. That planning-doc closeout is the decision record.
- ADR-0046:118 mentions a planned GitHub-login subscription gate in passing (a security-posture paragraph about OAuth scope). That mention is a **parenthetical**, not the metering decision, and must not be cited as one.
- The genuine residual inconsistency: signed-in users are still metered on the five generate routes, while chat / extract-decisions bypass when a session exists. PR #337's stated "signed-in + BYOK bypass" is therefore only half-true on generate.

A Phase 0 "fix" that added an unconditional signed-in bypass on generate would hand unlimited _server-paid_ cloud generation to anyone who completes GitHub OAuth. OAuth here is publish-authorization, not entitlement: there is no accounts table, no subscription, and no billing. That remedy is worse than the inconsistency.

The cautionary tale for Phase −1: this decision almost flipped twice because it lived only in a planning doc. Hence this ADR.

## Decision

**Leave metering as-is.** Do not touch quota code in the positioning arc.

- The spec→convert double-charge stays. It is a closed decision, not a defect to reopen.
- The signed-in / generate inconsistency is **an open product question for the subscription-gate design**. It is not a Phase 0 or Phase 1 bug. Implement nothing now.
- GitHub OAuth remains publish-authorization. It is not an unmetered-generation entitlement.

### Do-not-touch files

The following files are frozen against metering edits by this ADR. A PR that "fixes" quota behavior in any of them reverses this decision:

- `apps/web/lib/enforce-quota.ts`
- `apps/web/app/api/manifest/generate/route.ts`
- `apps/web/app/api/manifest/generate/stage/route.ts`
- `apps/web/app/api/manifest/generate/spec/route.ts`
- `apps/web/app/api/manifest/generate/spec/convert/route.ts`
- `apps/web/app/api/manifest/generate/local/route.ts`
- `apps/web/app/api/plan/extract-decisions/route.ts`
- `apps/web/app/api/llm/chat/route.ts`

Store and limiter implementations (`apps/web/lib/quota-store.ts`, `apps/web/lib/byok-store.ts`, `apps/web/lib/rate-limiter.ts`) are also out of scope for metering policy. Deploy-topology wiring of their db-path env vars is ADR-0064, not this ADR, and does not change their code.

## Consequences

- Phase 0.4's trust-fix list is the stale "ships dark" comment and the `hasByokKey` per-provider bug only. Quota is not on that list.
- The subscription-gate design (Phase 2) must explicitly answer: do signed-in free users stay metered on generate until they pay, or does a verified account become the entitlement boundary? Either answer is fine; silent drift from this ADR is not.
- Citing ADR-0046 as the quota decision is a documentation error. Cite this ADR and the 2026-08-13 closeout.
