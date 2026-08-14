# Archived — 2026-08-13 architecture review (historical artifacts)

**Status: SUPERSEDED. Do not action, do not edit, do not start work from these
files.**

The files in this folder are the raw, immutable output of the 2026-08-13
self-review (Review & Archeology mode). They are kept for provenance only.

- They were adversarially audited on 2026-08-14 — see
  [`AUDIT-2026-08-14.md`](./AUDIT-2026-08-14.md): 43/64 findings confirmed, 21
  overstated, 0 refuted; 45 severities lowered (all three "criticals"
  downgraded); 10 recommendations unsound; 22 material findings missed
  (AUD-001…022).
- The **active** artifact that supersedes all sequencing, severities, and
  recommendations here is
  [`../2026-08-14-architecture-remediation-plan.md`](../2026-08-14-architecture-remediation-plan.md).

## Contents (all superseded)

| File                     | What it was                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `ARCHITECTURE-REVIEW.md` | The review narrative (64 findings)                                                 |
| `BACKLOG.md`             | The review's topological backlog — **its ordering is stale**; use the plan's waves |
| `ADR-CANDIDATES.md`      | Candidate ADRs C1–C8 (several corrected/superseded — see the plan's Wave 0)        |
| `COVERAGE.md`            | What the review examined vs skipped                                                |
| `findings.json`          | Structured findings + verbatim evidence excerpts                                   |
| `inventory.json`         | Per-file inventory backing the review                                              |
| `AUDIT-2026-08-14.md`    | The audit that graded and corrected all of the above                               |

## Immutability

These are a **byte-exact historical snapshot** and must not be re-synced to
current code. In particular, `findings.json`'s `evidence[].excerpt` values are
verbatim source quotes captured at review time — they are the substrate of the
audit's "81/85 excerpts verbatim-accurate" integrity check. Editing them (for
example, to track code that has since moved) would destroy that guarantee and
produce noisy, meaningless diffs. If any of this material needs updating, add a
new dated artifact instead of mutating these files.
