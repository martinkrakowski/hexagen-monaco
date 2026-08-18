# ADR-0062: README Brownfield Claim and Public Copy

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Product
**Runbook ID:** D-2
**Relates to:** ADR-0061 (D-1 license split), [`2026-08-17-fde-gtm-development-runbook.md`](../../docs/planning/2026-08-17-fde-gtm-development-runbook.md) Phase −1 D-2, independent review N4 / N7

> Numbering note: Phase −1 batch. The historical ADR-0009/0010 numbering collisions are not reused. This runbook ID is **D-2** (README). It is not quota-D2 (ADR-0063) and not the architecture-remediation arc's D2 (BYOK persistence).

## Context

The root README advertised three things that are not true, not licensed, or not findable:

1. **"Automated brownfield ingestion engine."** Nothing of that kind exists. Phase 0 will ship assisted mapping (`adopt` / `bootstrap`), not autonomous ingestion. Advertising the stronger claim is a first-run trust failure of the class plan §7.1 calls existential.
2. **"Never transitions to open source."** A README sentence, not a license term (independent review N4). `LICENSE` has no such clause. After ADR-0061 the wedge _does_ convert to Apache-2.0 per-release after two years, so the sentence would also be false.
3. **Commercial contact with no channel (N7).** The README solicited commercial licensing inquiries and named Krakowski Cloud Solutions, LLC with no email, URL, or form.

Two further public-copy defects belong in the same one-day batch:

- Brand casing is mixed: headers use **Hexagen-Monaco**; body copy still says "HexaGen" / "HexaGen Monaco" (README lines 211 and 375 at the time of this decision). Canonical casing was already decided; public copy is where deferral stops.
- Existing `@hexagen-monaco/sync` generator users have no migration sentence. Generation is not being withdrawn; the headline is moving to conformance. 0.10.0's breaking-minor notes already set the precedent for saying that plainly.

## Decision

Rewrite the public copy in one batch:

1. **Brownfield claim.** Replace "automated brownfield ingestion engine" with **"assisted brownfield adoption tooling"**. Do not advertise ingestion, inference, or a one-shot import of a foreign repo. Those are Phase 3, behind a corpus.
2. **Commercial contact.** Inquiries go to https://github.com/martinkrakowski/hexagen-monaco/issues with the title prefix `[commercial]`.
3. **Delete** "never transitions to open source". Do not add an equivalent clause to `LICENSE`. The wedge's Apache conversion is already stated by FSL-1.1 and ADR-0061; the platform has no such promise and no such ban written as a legal term.
4. **Canonical brand: Hexagen-Monaco.** Public copy touched by this batch uses that casing. Internal identifiers (`@hexagen/*`, `HexaGen` in generated comments, historical ADRs) are not renamed here.
5. **Existing generator users.** One short paragraph: generation stays; the headline is now conformance; 0.10.0 is a breaking unpublished minor (a project that passed on 0.9.x can fail on 0.10.0).

Per-package license statements follow ADR-0061: wedge packages restate FSL-1.1-Apache-2.0; platform language is scoped to the platform.

## Consequences

- Root `README.md`, `packages/sync/README.md`, and `tools/arch-linter/README.md` are the documents this ADR binds. Marketing sites and npm descriptions should not re-introduce the three retired claims.
- "Assisted brownfield adoption tooling" is a Phase 0 promise, not a claim that `adopt` already exists. The wording is deliberately weaker than the old advertisement.
- Trademark copy sits next to the license section (ADR-0061). The mark is independent of FSL.
