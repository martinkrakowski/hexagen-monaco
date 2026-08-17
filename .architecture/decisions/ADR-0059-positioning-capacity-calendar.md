# ADR-0059: Positioning Capacity Calendar

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Product
**Runbook ID:** D-0
**Relates to:** [`2026-08-17-fde-gtm-development-runbook.md`](../../docs/planning/2026-08-17-fde-gtm-development-runbook.md) Phase −1; `docs/planning/2026-08-17-remaining-work-summary.md` (untracked architecture-remediation Phases 6–8 inventory); ADR-0060 (D-3), ADR-0061 (D-1)

> Numbering note: the highest pre-existing record was ADR-0058; this ADR opens the Phase −1 positioning batch (ADR-0059 through ADR-0064). The historical ADR-0009/0010 numbering collisions are not reused.

## Context

Two calendars were live on the same tree on the same day:

1. **Architecture-remediation** — Phases 0–5 are complete. Phase 6 still has three legs (6.5(c), 6.7(a), 6.7(c)). Phase 7 has not started (7.1 → 7.6, strictly serial). Phase 8 has eight remaining legs (8.12(a–h), then 8.1 → 8.2). Recorded in `docs/planning/2026-08-17-remaining-work-summary.md`.
2. **Conformance positioning** — the runbook wants Phase −1 this week and 3–5 weeks of Phase 0 immediately, then Phase 1 and (if D-3 is business) Phase 2.

A solo founder cannot run both at full speed. Leaving the choice implicit is how Phase 0 would stretch until it is no longer a kill-question, and how remediation would stall mid-fence. The three options were: park remediation Phases 6–8; finish the small remaining remediation legs first; or accept Phase 0 as part-time and stretch its calendar.

The positioning planning documents stay out of remediation PRs (untracked until deliberately committed). That isolation is load-bearing: mixing the two arcs in one PR would hide which calendar is active.

## Decision

**Park architecture-remediation Phases 6–8. Positioning Phase 0–2 is the active calendar.**

- Remediation work already merged (Phases 0–5, and the Phase 8 legs that landed) stays. No rollback.
- Remaining remediation legs (6.5(c), 6.7(a), 6.7(c), Phase 7, remaining 8.12 / 8.1 / 8.2) are not scheduled against the positioning calendar. They resume only by a later amendment to this ADR, or after positioning Phase 2's gate (someone pays for hosted history) or Phase 0's kill criterion (the engine only lands on Hexagen-generated code).
- Positioning Phase −1 (this batch of ADRs) lands first. Phase 0–2 then execute in runbook order. Phase 3 (inference / Gauntlet) and Phase 4 (enterprise) stay out of the active calendar; they are gated by the runbook and are not unparked by this decision.
- The two historical positioning drafts (`docs/planning/2026-08-17-conformance-positioning-plan.md`, `docs/planning/2026-08-17-positioning-plan-validation-and-adversarial-review.md`) remain provenance. They are not edited to "catch up" with this calendar.

Rejected alternatives:

- **Finish the small remaining remediation legs first.** They are not small as a set (Phase 7 is a serial six-item wave; 8.12(h) is the large Generate-with-AI extraction). Starting them "quickly" would consume the same weeks Phase 0 needs for the foreign-repo trial.
- **Run Phase 0 part-time.** That stretches the kill-question past the point where the answer still changes what gets built.

## Consequences

- Reviewers treat positioning PRs as the in-flight work. A remediation PR against a parked phase needs an explicit reopen, not a drive-by.
- The ratchet baseline, the published-package floor, and the fence already built in Waves 0–5 remain in force. Parking implementation does not park enforcement.
- Capacity is no longer a planning-doc footnote. Reopening remediation Phases 6–8, or stretching Phase 0, requires amending this ADR.
