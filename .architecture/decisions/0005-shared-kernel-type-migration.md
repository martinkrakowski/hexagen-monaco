# ADR-0005: Shared Kernel Type Migration

**Status:** Accepted  
**Date:** 2026-03-12  
**Deciders:** Architecture team  
**Supersedes:** None

## Context

The `web-driver` package needed to implement `MonacoPersistencePort` to provide browser-based persistence via `LocalStoragePersistenceAdapter`. However, the port interface and related types (`MonacoSession`, `SessionMetadata`, `PersistenceError`) were defined in `@hexagen/monaco-orchestration`.

This created a forbidden cross-bounded-context dependency:

```
web-driver → monaco-orchestration (VIOLATION)
```

According to hexagonal architecture principles, drivers should only depend on:
1. The shared kernel (`@hexagen/shared`)
2. Ports they implement (which should be in the shared kernel if cross-context)

A temporary exception was added to `.architecture/invariants/linter-config.yaml` to unblock development, but this violated our architectural constraints and accumulated technical debt.

## Decision

Move the following types from `@hexagen/monaco-orchestration` to `@hexagen/shared`:

| Type | Original Location | New Location |
|------|-------------------|--------------|
| `MonacoSession` | `monaco-orchestration/src/domain/model/` | `shared/src/domain/` |
| `SessionMetadata` | `monaco-orchestration/src/application/ports/out/` | `shared/src/domain/` |
| `PersistenceError` | `monaco-orchestration/src/application/ports/out/` | `shared/src/domain/` |
| `MonacoPersistencePort` | `monaco-orchestration/src/application/ports/out/` | `shared/src/application/ports/` |

The original locations in `monaco-orchestration` now re-export from `@hexagen/shared` for backward compatibility.

## Rationale

### Why Shared Kernel?

These types represent the **contract** between bounded contexts:
- `monaco-orchestration` defines the business logic for editor sessions
- `web-driver` provides the browser-specific persistence implementation
- Both need to agree on the shape of `MonacoSession` and `MonacoPersistencePort`

The shared kernel pattern (DDD) is designed exactly for this: types that multiple bounded contexts must share to communicate.

### Why Not Keep in monaco-orchestration?

1. **Violates dependency rule** — Drivers should not depend on orchestration packages
2. **Creates coupling** — Changes to `monaco-orchestration` internals could break `web-driver`
3. **Unclear ownership** — The port is consumed by `web-driver` but defined in `monaco-orchestration`

### Why Re-export for Backward Compatibility?

Existing code may import from `@hexagen/monaco-orchestration`. The re-exports ensure:
- No breaking changes for existing consumers
- Gradual migration path
- Single source of truth (shared) with convenient aliases

## Consequences

### Positive

- ✅ `web-driver` now only depends on `@hexagen/shared` (architecturally correct)
- ✅ Linter exception removed — no more technical debt workaround
- ✅ Clear ownership: shared types live in shared kernel
- ✅ Both packages import from the same source (no type mismatches)

### Negative

- ⚠️ `@hexagen/shared` grows in scope (acceptable for true shared-kernel types)
- ⚠️ Two import paths work (`@hexagen/shared` and `@hexagen/monaco-orchestration`) — may cause confusion

### Neutral

- Re-exports add a small indirection layer (no runtime cost, types only)

## Implementation

### Phase 1: Fix Barrel Generation (Prerequisite)

Before moving types, the sync engine's barrel generation needed fixes:
- Recursive barrel generation for nested directories
- `.d.ts` artifact filtering
- Circular export detection

See commits `9fc475d`, `e69ad9b`, `88c5f48`.

### Phase 2: Move Types

1. Created new files in `@hexagen/shared`:
   - `src/domain/monaco-session.ts`
   - `src/domain/session-metadata.ts`
   - `src/domain/persistence-error.ts`
   - `src/application/ports/monaco-persistence.port.ts`

2. Updated `@hexagen/shared` barrels to export new types

3. Changed `@hexagen/monaco-orchestration` originals to re-export from shared

4. Updated `@hexagen/web-driver` imports to use `@hexagen/shared`

### Phase 3: Remove Exception

Deleted the `@hexagen/monaco-orchestration` entry from `web-driver`'s `allowed_imports` in `linter-config.yaml`.

## Verification

```bash
yarn build          # ✅ 17 successful
yarn typecheck      # ✅ 24 successful
yarn lint           # ✅ No errors
yarn lint:arch      # ✅ Compliant (no exceptions needed)
```

## Related

- [ADR-0001: Persistence Wiring](./0001-persistence-wiring.md)
- [ADR-0002: Sync Engine Structural Fixes](./0002-sync-engine-structural-fixes.md)
- [AGENTS.md §5: Architecture Directory](../README.md)
