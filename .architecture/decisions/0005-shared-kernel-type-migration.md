# ADR-0005: Shared Kernel Type Migration

**Date:** 2026-04-15
**Status:** Accepted
**Authors:** Architecture Co-pilot, Human Architect
**Supersedes:** None

---

## Context

The monorepo has cross-cutting types (Identifier, CustomError, PersistedEditorWorkspace, PersistedCanvasLayout) that are needed by multiple packages. Without a shared kernel, each package would either duplicate these types or create circular dependencies importing from each other.

## Decision

Establish two shared-kernel packages:

1. **`@hexagen/shared`** — Cross-cutting primitives: custom errors, base classes, utility types (Identifier, PersistedEditorWorkspace, PersistedCanvasLayout, WizardData, etc.). Accessible from all layers in all packages.

2. **`@hexagen/core-domain`** — MVK semantic contracts: DomainAST, NodeKind, EdgeKind, RRP, REM, DomainCommand, IntentLineage, TopologyInvariants, CardinalityInvariants, NodeVisualSpec. Treated as a shared-kernel peer because every kernel package must validate against these contracts. Accessible from all layers in all packages.

Both packages are registered in `.architecture/invariants/layer-rules.yaml` under `shared_kernels` with `allowed_in_all_layers: true`.

## Consequences

### Positive

- No circular dependencies between packages that need shared types
- Single source of truth for cross-cutting primitives and MVK contracts
- arch-lint can enforce shared-kernel boundaries automatically

### Negative

- Changes to shared kernels have wide blast radius
- Core-domain as shared kernel means kernel packages depend on it freely — must guard against coupling to implementation details rather than contracts

## Related

- ADR 0018: MVK Semantic Kernel Contracts (extends this shared kernel framing)
