# Architectural Planning

This section contains the living roadmap and detailed execution plans for HexaGen Monaco.

## Purpose

Planning artifacts here are **human-first**. They describe sequencing, parallelization opportunities, risks, and gates in a scannable way.

The detailed technical work for the Core Implementation effort (originally the Phase 3–7 work) is now organized by individual phase for better readability.

## Current Documents

All Core Implementation planning artifacts now live under the `core-implementation/` subfolder:

- [Core Implementation Roadmap](core-implementation/roadmap.md)
- [Overview](core-implementation/overview.md)
- [Phase 3 — Execution DAG](core-implementation/phase-3.md)
- [Phase 4 — Transaction System](core-implementation/phase-4.md)
- [Phase 5 — Probabilistic Layer](core-implementation/phase-5.md)
- [Phase 6 — System Verification](core-implementation/phase-6.md)
- [Phase 7 — Composition-Root Purification](core-implementation/phase-7.md)

## Relationship to Other Sections

- **Governance** — [Architectural governance debt](../governance/debt.md) and migration work that may cut across phases.
- **Architecture** — The contracts and decisions these plans must respect.
- `.architecture/` — Machine contracts and historical planning pointers (see `docs/planning/legacy/`)

## Maintenance

When a phase completes or major risks change:
1. Update the roadmap.
2. Update status in the execution plan.
3. Consider whether a new ADR or debt item is required.
4. Keep cross-links to `.architecture/manifest.yaml` and relevant ADRs accurate.
