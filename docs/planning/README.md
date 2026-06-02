# Architectural Planning

This section contains the living roadmap and detailed execution plans for HexaGen Monaco.

## Purpose

Planning artifacts here are **human-first**. They describe sequencing, parallelization opportunities, risks, and gates in a scannable way.

The detailed technical work for the Core Implementation effort (originally the Phase 3–7 work) is now organized by individual phase for better readability.

## Current Documents

All Core Implementation planning artifacts now live under the `core-implementation/` subfolder:

- [Core Implementation Roadmap](core-implementation/roadmap.md)
- [Overview](core-implementation/overview.md)
- [Phase 3 — Execution DAG](core-implementation/execution-dag.md)
- [Phase 4 — Transaction System](core-implementation/transaction-system.md)
- [Phase 5 — Probabilistic Layer](core-implementation/probabilistic-layer.md)
- [Phase 6 — System Verification](core-implementation/system-verification.md)
- [Phase 7 — Composition-Root Purification](core-implementation/composition-root-purification.md)

## Relationship to Other Sections

- **Governance** — architectural governance debt and cross-cutting migration work, tracked in the relevant [ADRs](../../.architecture/decisions/).
- **Architecture** — The contracts and decisions these plans must respect.
- `.architecture/` — Machine contracts: manifest, invariants, and ADRs as primary records.

## Maintenance

When a phase completes or major risks change:

1. Update the roadmap.
2. Update status in the execution plan.
3. Consider whether a new ADR or debt item is required.
4. Keep cross-links to `.architecture/manifest.yaml` and relevant ADRs accurate.
