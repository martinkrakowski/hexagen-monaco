# @hexagen/intent-compiler — FROZEN

**Status:** Frozen as of Phase 6 architectural audit.

## Rationale

This package has **no runtime consumers** on the main application path:

- Not imported by `apps/web/` or `wire.ts`
- Not imported by any other `@hexagen/*` package at runtime
- Only referenced in test configs and lint allowlists

All infrastructure adapters were stubs returning hardcoded/mock data:

- `DefaultGestureParserAdapter` — returned a mock empty AST
- `RRPTopologyCheckerAdapter` — always returned `{ isValid: true }`
- `RRPCardinalityCheckerAdapter` — always returned `{ isValid: true }`
- `DefaultRejectEmitterAdapter` — no-op (silent swallow)
- `RejectEmitter` (reject-emitter.ts) — dead code not exported from barrel

## What was preserved

- **Domain layer:** `Gesture`, `Rejection`, `ParsedGesture`, `TopologyCheckResult`, `CardinalityCheckResult`
- **Application layer:** All port interfaces and use case classes
- These types define the contract for future intent compilation when real consumers emerge

## What was removed

- All infrastructure adapters (stubs)
- `reject-emitter.ts` (dead code, not in barrel)
- All test files and test doubles
- `@hexagen/runtime` dependency (only used by removed `reject-emitter.ts`)
