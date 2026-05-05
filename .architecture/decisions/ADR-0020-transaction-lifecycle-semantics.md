# ADR 0020: Transaction Lifecycle & Speculative State Semantics

## Status

Accepted

## Context

We need to complete the transaction system to bind intent, REM, and lineage together. The transaction system handles:

- Executing transactions that bind intent + REM + lineage
- Rolling back transactions when REM becomes stale
- Committing transactions to promote speculative → confirmed state
- Querying the semantic cache
- Managing backpressure and speculative state machine

## Decision

We will implement the transaction system with the following components:

### Value Objects

1. `TransactionId`: Stable hash-based identifier for transactions
2. `SpeculativeState`: Discriminated union (pending/confirmed/reconciled/discarded)
3. `BackpressureSignal`: Signals for backpressure handling
4. `CacheEntry`: Entries in the semantic cache with explicit exclusion list

### Use Cases

1. `ExecuteTransactionUseCase`: Binds intent + REM + lineage
2. `RollbackTransactionUseCase`: Handles stale REM recovery
3. `CommitTransactionUseCase`: Promotes speculative → confirmed
4. `QueryCacheUseCase`: Queries the semantic cache

### Infrastructure Adapters (to be upgraded)

1. `InMemorySpeculativeStateMachineAdapter`: Enforces monotonicity invariant
2. `InMemoryBackpressureControllerAdapter`: Implements intent coalescing
3. `InMemorySemanticCacheAdapter`: Cache key = hash(normalized DomainAST + RRP version)
4. `InMemoryTransactionManagerAdapter`: Orchestrates all components

## Consequences

### Positive

- Clear transaction lifecycle management
- Speculative state safety with monotonicity guarantees
- Semantic caching with proper key derivation
- Backpressure handling with intent coalescing

### Negative

- Increased complexity in transaction management
- Need for careful cache key design to avoid leaking non-semantic state

## Implementation Plan

See `.architecture/plans/phase-3-7-execution-plan-v1.md` Phase 4 atomic units.

## Related

- ADR 0019: Execution DAG Architecture
- Phase 4: Transaction System completion
