# Phase 6 — System Verification

**Workstream:** Core Implementation  
**Phase:** 6

## Goal

Provide comprehensive, automated verification that the delivered core system meets its architectural invariants, performance, accessibility, and quality targets.

## Key Focus Areas

- Large-scale property-based testing across core packages (DomainAST invariants, RRP determinism, layout feasibility, etc.).
- Compile-time exhaustiveness checking for all major discriminated unions.
- End-to-end regression flows (wizard → canvas → governance → export).
- Accessibility audit (axe-core AA compliance).
- Bundle size and runtime performance budgets (60fps canvas, First Load JS targets).
- LLM schema-drift regression testing under realistic workloads.

## Status

This phase was still in flight at the time of the original plan. Many of the verification tasks were designed to run in parallel with parts of Phase 7.

## Success Criteria (from original plan)

- All property test suites passing at 1000+ scenario scale.
- Budgets and accessibility targets met.
- Final verification ADR published.

For the complete original verification task list (6.1–6.10), see the historical combined Phase 3–7 Execution Plan.
