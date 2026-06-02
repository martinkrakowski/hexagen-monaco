# Transaction System

**Workstream:** Core Implementation

## Goal

Complete the `transaction-system` package with production-grade semantics for speculative execution, backpressure, semantic caching, and safe atomic mutations with rollback.

## Key Deliverables

- `Transaction`, `SpeculativeState`, `BackpressureSignal`, and related value objects.
- Full speculative state machine with monotonicity guarantees.
- Intent coalescing logic with fidelity degradation under pressure.
- Semantic cache keyed on normalized DomainAST + RRP version (with explicit exclusion of transient/spatial data).
- Transaction lifecycle use cases (execute, rollback, commit).
- Integration points with `ReconcileUseCase` and manifest mutation adapters.

## Associated ADRs

- **ADR-0020**: Transaction Lifecycle Semantics

## Status

Scaffold and core semantics were delivered. Some advanced backpressure and cache behaviors were still being hardened later.

## Important Design Decisions

- Transactions are first-class architectural citizens, not just infrastructure concerns.
- The system must support speculative work that can be safely discarded without side effects on the manifest.
- Cache key design was deliberately strict to prevent subtle semantic drift.

For the full original atomic unit breakdown, property test expectations, and integration details, refer to the original combined execution plan.
