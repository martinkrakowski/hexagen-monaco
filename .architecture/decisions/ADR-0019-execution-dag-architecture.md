# ADR 0019: Execution DAG Architecture

## Status

Accepted

## Context

We need to restructure the core deterministic kernel packages to follow hexagonal architecture and reduce boolean prop proliferation in UI components. This involves creating three new packages: `intent-compiler`, `layout-engine`, and `ui-projection-compiler`.

## Decision

We will create three new bounded contexts in the deterministic kernel plane:

1. `intent-compiler`: responsible for parsing gestures and validating commands against the domain model (MVK v1).
2. `layout-engine`: responsible for solving geometric layout constraints and generating affordances.
3. `ui-projection-compiler`: responsible for mapping domain nodes to visual variants (colors, icons, etc.) and projecting affordances.

Each package will follow hexagonal architecture with:

- Domain layer (value objects, entities)
- Application layer (ports and use cases)
- Infrastructure layer (adapters)
- No dependencies on UI frameworks (React, xyflow) in the kernel packages.

## Consequences

### Positive

- Clear separation of concerns
- Testable domain logic without UI dependencies
- Elimination of hardcoded visual maps from feature code
- Ability to evolve each kernel package independently

### Negative

- Increased number of packages
- Indirection through ports and use cases

## Implementation Plan

See `.architecture/plans/phase-3-7-execution-plan-v1.md` for detailed atomic units.

## Related

- ADR 0018: (existing)
- Phase 3.A: intent-compiler restructure
- Phase 3.B: layout-engine creation
- Phase 3.C: ui-projection-compiler creation
