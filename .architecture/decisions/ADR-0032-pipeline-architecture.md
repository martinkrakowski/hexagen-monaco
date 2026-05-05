# ADR-0032: Pipeline Architecture — ManifestPatchPort Design Decision

## Status

Accepted

## Date

2026-04-26

## Context

Phase C code review identified that `ManifestPatchPort` in `reconciliation-engine` is declared in manifest.yaml but never implemented or wired into the active pipeline.

The active pipeline uses `ModifyArchitectureUseCase` (in `@hexagen/agentic-interaction`) which orchestrates the full flow:

1. Parse NL intent → DomainCommand[]
2. Compile prompt
3. LLM inference → StructuredLLMOutput
4. Reconciliation → Patch[]
5. Commit patches → Transaction

Step 4 delegates to `ReconcileUseCase` (Phase D-1 fix), which uses `ManifestMutationPort` from `transaction-system` (implemented by `SyncDelegatingManifestMutationAdapter`) for atomic manifest mutations.

## Decision

The `ManifestPatchPort` interface will remain as a **design artifact**. The active pipeline uses `ManifestMutationPort` from `transaction-system`, which handles atomic manifest mutations with git-based rollback.

## Rationale

1. **Two ports serve different layering purposes:**
   - `ManifestMutationPort` (transaction-system): Atomic apply + rollback for transaction system
   - `ManifestPatchPort` (reconciliation-engine): Optional validation-only interface for standalone reconciliation use

2. **ReconcileUseCase is designed for standalone use:**
   The active pipeline uses `ModifyArchitectureUseCase` which delegates to `ReconcileUseCase` (D-1 fix). `ReconcileUseCase` is a self-contained use case with its own ports.

3. **Browser bundling constraints:**
   Adding `ManifestPatchAdapter` to `reconciliation-engine` would require `@hexagen/sync` as a direct dependency. `@hexagen/sync` uses Node.js built-ins (`node:path`, `fs/promises`, `child_process`) which cannot be bundled for browser environments by Next.js webpack.

## Consequences

### Positive

- Clear separation of concerns: reconciliation-engine doesn't know about git operations
- `SyncDelegatingManifestMutationAdapter` handles all manifest mutations atomically
- No browser bundling issues

### Negative

- `ManifestPatchPort` remains unused in production wiring
- Future contributors may be confused by the unused port

### Mitigations

- Document this decision in ADR
- If `reconciliation-engine` gains independent apply responsibility in the future, implement `ManifestPatchAdapter` at that time

---

## Related Decisions

- [ADR-0031](./ADR-0031-pipeline-phased-implementation.md): Phased approach for pipeline implementation
- [ADR-0012](./ADR-0012-interactive-architecture-modification.md): Human-guided interaction model

---

## Review History

| Phase | Change                                                    |
| ----- | --------------------------------------------------------- |
| D-1   | Wired `ReconcileUseCase` into `ModifyArchitectureUseCase` |
| D-2   | Removed deprecated `promoteState()` method                |
