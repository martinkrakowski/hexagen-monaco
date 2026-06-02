# Core Implementation Overview

**Workstream:** Core Implementation

This is the major body of work to realize the full HexaGen Monaco three-plane system after the foundational MVK v1 contracts and early projection kernel isolation were complete.

## Scope

The workstream covers:

- Completion of the **Deterministic Kernel** (intent-compiler, layout-engine, ui-projection-compiler, transaction-system, etc.)
- Delivery of the **Probabilistic Layer** (prompt-compiler, reconciliation-engine, LLM integration)
- **System Verification** across property tests, accessibility, performance, and schema stability
- **Composition Root Purification** — removing kernel logic from the application layer

## Workstreams

| Name                          | Primary Focus                                        | Status (historical) |
| ----------------------------- | ---------------------------------------------------- | ------------------- |
| Execution DAG                 | First vertical slices (Intent + Layout + Projection) | Largely complete    |
| Transaction System            | Speculative state, backpressure, safe mutations      | Core delivered      |
| Probabilistic Layer           | Prompt compilation, LLM ACLs, reconciliation         | Largely complete    |
| System Verification           | Property testing, budgets, a11y, E2E                 | In flight           |
| Composition-Root Purification | Extraction of kernel logic from app layer            | In flight           |

## Shared Principles

Every atomic unit across this workstream was required to follow:

- Manifest-first changes
- Full build + typecheck + lint + arch-lint
- Independent test coverage
- Clear entry and exit gates

## Cross-Cutting Concerns

Topics that span multiple workstreams (parallelization strategy, risk register, success metrics, authority migration from manifest to MVK) are documented in the original combined execution plan (available in git history).
