# Phase 5 — Probabilistic Layer

**Workstream:** Core Implementation  
**Phase:** 5

## Goal

Build the probabilistic layer components that sit above the deterministic kernel while maintaining strict isolation.

## Major Sub-Areas

### 5.A — Prompt Compiler

- RRP-driven system instruction and Zod schema generation.
- Structured prompt compilation and caching.
- Migration of legacy prompt logic (`grounded-prompt.ts`, governance question templates, etc.) out of the app layer.

### 5.B — LLM Adapters & ACL Enforcement

- Strong enforcement that LLM calls go through the Prompt Compiler.
- Schema validation on every response.
- Extraction of model catalogs and provider configuration from `apps/web/app/config/`.

### 5.C — Reconciliation Engine

- Verdict comparison and state promotion logic.
- Conflict resolution that never overrides the deterministic kernel.
- Monotonic state machine for reconciliation outcomes.

## Critical Principle

**LLM outputs must never bypass the deterministic kernel.** All paths are required to go through prompt compilation + schema validation + reconciliation.

## Associated ADRs

- **ADR-0021**: Prompt Compilation & LLM ACL
- **ADR-0022**: Server LLM ACL

## Status

Core packages and ACL boundaries were largely delivered. Some cloud LLM adapter work was deferred.

For the detailed atomic units and migration tables, see the historical combined Phase 3–7 Execution Plan.
