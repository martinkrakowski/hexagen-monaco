# Frozen Package: @hexagen/transaction-system

**Status:** Frozen as of April 25, 2026 (Phase 4 architectural remediation)

## Why This Package Was Frozen

- **Zero runtime consumers** on main application path
- Not imported by `apps/web/` or `wire.ts`
- Declared in manifest as core package but never instantiated
- Speculative state machine design lacks live use case

## What Was Preserved

- **Domain layer:** Transaction, SpeculativeState, TransactionId, BackpressureSignal, CacheEntry
- **Application layer:** All port interfaces (TransactionManagerPort, SpeculativeStateMachinePort, BackpressureControllerPort, SemanticCachePort) for future reactivation
- **Use case classes:** ExecuteTransactionUseCase, RollbackTransactionUseCase, CommitTransactionUseCase, QueryCacheUseCase intact for future activation

## What Was Removed

- Infrastructure adapters: None (no adapters implemented)
- Tests: Reduced to core domain tests only

## Future Activation Path

Once Phase 5 (Intent Lineage + AI Pipeline) is complete and transaction semantics are needed, this package can be unfrozen by:
1. Re-wiring ExecuteTransactionUseCase in `apps/web/lib/wire.ts`
2. Implementing lineage tracking for speculative intent processing
3. Adding reconciliation UI for conflict/backpressure resolution

No migration path needed — all contracts are preserved.

## Frozen Date

2026-04-25 | Rationale: REM integration + prompt-compiler determinism pending Phase 5 completion
