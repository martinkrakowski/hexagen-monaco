# Three-Plane System Overview

HexaGen Monaco is a **compiled, contract-first semantic execution environment** for UI + AI + geometric constraint systems.

## Three-Plane Topology

The system is deliberately organized into three non-interacting planes:

| Plane                | Role                                              | Primary Packages |
|----------------------|---------------------------------------------------|------------------|
| **Deterministic Kernel** | Semantic truth, rule resolution, execution        | core-domain, intent-compiler, layout-engine, ui-projection-compiler, transaction-system, wizard-orchestration, ... |
| **Projection**       | Render derived state only (UI framebuffer, layout) | ui, visualization, web-driver |
| **Probabilistic**    | Observational validation, annotation, LLM outputs | local-llm, agentic-interaction, prompt-compiler, reconciliation-engine, mcp-server |

The MVK (Minimal Viable Kernel) specification in `.architecture/mvk/spec-v1.md` defines the stable contract surface between these planes.

## Key Architectural Characteristics

- **Manifest-first + MVK sovereignty** — Architecture is declared in `manifest.yaml` and refined through MVK contracts. Later phases migrate semantic authority toward MVK.
- **Hexagonal / Ports & Adapters** inside every package.
- **Strict layer boundaries** enforced by the arch-linter (`domain` → `application` → `infrastructure`).
- **Shared kernel** (`@hexagen/shared`) only for types that truly cross bounded contexts.
- **No kernel logic in apps/web/app/lib/** after Phase 7.

## Primary Sources of Truth

- [.architecture/manifest.yaml](../.architecture/manifest.yaml) — Bounded contexts, ports, apps
- [.architecture/mvk/spec-v1.md](../.architecture/mvk/spec-v1.md) — DomainAST, NodeVisualSpec, RRP/REM contracts
- [.architecture/decisions/](../.architecture/decisions/) — 39+ Architecture Decision Records
- [.architecture/invariants/](../.architecture/invariants/) — Layer rules + linter configuration

## Entry Points for Contributors

- New to the architecture? Start with the [Decisions Index](decisions/index.md) and this overview.
- Making structural changes? Read `.architecture/README.md` and the relevant ADRs first.
- Planning or remediation work? See the sibling [Planning](../planning/) and [Remediation](../remediation/) sections in the parent docs folder.

This document is intentionally short. The real detail lives in the contracts and decision records.
