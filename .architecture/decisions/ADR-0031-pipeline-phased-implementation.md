# ADR-0031: Phased Pipeline Implementation (Superseding PR #26 Scaffolding)

**Date:** 2026-04-26
**Status:** Accepted
**Supersedes:** Orphaned commits `8987804`, `26589de` from deleted `feature/ai-driven-architecture-modification` branch
**Superseded By:** None
**Drivers:** PR #26 was a 270-file mega-PR mixing concerns across all pipeline layers; no clean review path
**Related:** `docs/pipeline-implementation-summary.md`; Phase 0–7 implementation

---

## Context

An initial `feature/ai-driven-architecture-modification` branch (PR #26) attempted to implement the architecture modification pipeline as a single large change. The branch was deleted during Phase 0 cleanup after identifying the following problems:

1. **270 files changed** — impossible to review atomically
2. **Mixed concerns** — domain models, adapters, API routes, and UI components in one diff
3. **Incomplete scaffolding** — barrel files referenced 5 domain modules that were never created (`architecture-modification.ts`, `model-interaction.ts`, `compiled-authority.ts`, `pipeline-configuration.ts`)
4. **Over-specified dependencies** — `@hexagen/ai-pipeline` depended on all 6 pipeline packages at the domain layer
5. **Naive domain models** — `PipelineRun` had no step tracking, no intent field, no lifecycle transitions; used "Compiled Authority" model that was abandoned in favor of DomainCommand/reconciliation

Two orphaned commits (`8987804`, `26589de`) remain in the object store from this branch but are not reachable from any branch.

## Decision

1. **Discard the orphaned commits** — they represent a strictly inferior subset of the current implementation. All functionality they envisioned (and more) is implemented in Phases 2a–7 with ~351 passing tests.

2. **Adopt the phased 0–7 approach** — each phase is independently reviewable, atomically mergeable, and gated by CI.

3. **Delegate manifest writes to `@hexagen/sync`** — the orphaned approach proposed a separate `manifest-patcher` package. The phased approach uses `ManifestMutationPort` delegating to `SyncDelegatingManifestMutationAdapter`, avoiding dual-writer drift.

4. **Use DomainCommand model, not "Compiled Authority"** — the orphaned approach used a "Compiled Authority" / "ModelInteraction" model that was never fully specified. The phased implementation uses `DomainCommand` (from `@hexagen/core-domain`) with concrete variants: `add_context`, `remove_context`, `add_port`, `remove_port`, `add_edge`, `remove_edge`, `update_node`.

## Consequences

- The orphaned commits `8987804` and `26589de` are formally superseded and may be garbage-collected by Git
- No code from the deleted branch needs to be preserved — the current implementation has full parity
- The `docs/ai-architecture-modification-pipeline-plan.md` from the orphaned commits is superseded by `docs/pipeline-implementation-summary.md`
- Future pipeline work builds on the phased implementation, not the PR #26 scaffolding

## Comparison: Orphaned vs Current

| Aspect                 | Orphaned (8987804/26589de)                                      | Current (Phases 0–7)                                                             |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PipelineRun` model    | `id + status + startTime + metadata`                            | `id + intent + status + steps[] + createdAt + completedAt` with 5 pure functions |
| `PipelineStep` concept | Does not exist                                                  | Full value object with lifecycle: pending → running → completed/failed/skipped   |
| Package structure      | Barrel references 5 non-existent files                          | Complete DDD structure with all files, 33+ tests                                 |
| Domain model           | "Compiled Authority" / "ModelInteraction" (never implemented)   | NL-to-DomainCommand parser, ParsedIntent with confidence scoring                 |
| Plan document          | Phase A–G, "Compiled Authority", new `manifest-patcher` package | Phase 0–7, DomainCommand model, `@hexagen/sync` delegation                       |
| Dependencies           | `ai-pipeline` depends on all 6 pipeline packages                | `ai-pipeline` depends only on `@hexagen/core-domain`, `@hexagen/shared`          |
| Manifest writes        | Proposed separate `manifest-patcher` package                    | `ManifestMutationPort` → `SyncDelegatingManifestMutationAdapter`                 |
| Tests                  | 0                                                               | ~351                                                                             |
