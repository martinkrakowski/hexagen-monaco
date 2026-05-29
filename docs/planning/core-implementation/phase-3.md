# Phase 3 — Execution DAG

**Workstream:** Core Implementation  
**Phase:** 3

## Goal

Deliver the first coordinated vertical slices of the three-plane architecture on top of the frozen MVK v1 contracts.

## Sub-Phases & Key Deliverables

### 3.A — Intent Compiler DDD Restructuring
- Converted the previously flat `intent-compiler` into a proper hexagonal structure.
- Introduced core domain entities (Gesture, Rejection, topology/cardinality results).
- Created application ports and use cases for gesture parsing, validation, and rejection emission.
- Moved adapters into `infrastructure/adapters` with clear port interfaces.
- Established test doubles for all ports.

### 3.B — Layout Engine (New Package)
- New `@hexagen/layout-engine` package created as a pure geometric constraint solver.
- No semantic (MVK) types allowed in its public API — only geometric constraints and affordances.
- Delivered initial port/adapter structure for layout solving, affordance resolution, stability scoring, and violation detection.
- Began migration of legacy layout logic out of `apps/web/app/lib/`.

### 3.C — UI Projection Compiler (New Package)
- New `@hexagen/ui-projection-compiler` package responsible for `DomainAST → NodeVisualSpec` mapping.
- Responsible for variant resolution, icon mapping, and projection validation.
- Strong isolation: no React, no xyflow, no framework-specific code in the compiler itself.

## Associated ADRs
- **ADR-0019**: Execution DAG Architecture (the structural decision to build these three slices in parallel)

## Status (as of latest update)
- Largely complete in terms of initial structure and package creation.
- Some consumer migration work remained (especially wiring the new compilers into the canvas).

## Key Constraints & Lessons
- Strict MVK discipline was non-negotiable from day one.
- The decision to keep layout and projection concerns purely geometric (no NodeKind leakage) has proven valuable for maintainability.
- Early creation of test doubles paid off significantly during later integration.

For the complete original list of atomic units (3.A.1 – 3.C.24), detailed entry/exit gates, and migration steps, see the historical combined Phase 3–7 Execution Plan in git history.
