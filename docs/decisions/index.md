# Architecture Decision Records — Index

This page provides a human-friendly index into the Architecture Decision Records.

**Canonical location of all ADRs:** [.architecture/decisions/](../../.architecture/decisions/)

> **Rule:** Full ADR text lives only in `.architecture/decisions/`. This index contains status, one-line summaries, and links.

## Status Legend

- ✅ **Accepted** — Implemented and stable
- 🟡 **In Progress** / Proposed
- ❌ **Superseded** or **Deprecated**

## All ADRs

| ADR     | Title                                              | Status   | Date       | One-Line Summary / Theme                          | Link |
|---------|----------------------------------------------------|----------|------------|---------------------------------------------------|------|
| 0000    | Next.js with Webpack over Vite                     | Accepted | 2026-04    | Build & bundling foundation                       | [0000](../../.architecture/decisions/ADR-0000-nextjs-webpack-over-vite.md) |
| 0001    | Persistence Wiring                                 | Accepted | —          | Adapter + port approach for storage               | [0001](../../.architecture/decisions/ADR-0001-persistence-wiring.md) |
| 0002    | Sync Engine Structural Fixes                       | Accepted | —          | Generator & barrel correctness                    | [0002](../../.architecture/decisions/ADR-0002-sync-engine-structural-fixes.md) |
| 0003    | External Project Generation MVP                    | Accepted | —          | Initial generator surface                         | [0003](../../.architecture/decisions/ADR-0003-external-project-generation-mvp.md) |
| 0004    | CI Build & TypeScript Monorepo Resolution          | Accepted | —          | Path mapping & build strategy                     | [0004](../../.architecture/decisions/ADR-0004-ci-build-typescript-monorepo-resolution.md) |
| 0005    | Shared Kernel Type Migration                       | Accepted | —          | Moving common types to @hexagen/shared            | [0005](../../.architecture/decisions/ADR-0005-shared-kernel-type-migration.md) |
| 0018    | MVK Semantic Kernel Contracts                      | Accepted | 2026-04    | Three-plane contract surface (foundational)       | [0018](../../.architecture/decisions/ADR-0018-mvk-semantic-kernel-contracts.md) |
| 0019    | Execution DAG Architecture                         | Accepted | 2026-04    | Phase 3 structure (intent + layout + projection)  | [0019](../../.architecture/decisions/ADR-0019-execution-dag-architecture.md) |
| 0020    | Transaction Lifecycle Semantics                    | Accepted | —          | Speculative state, rollback, backpressure         | [0020](../../.architecture/decisions/ADR-0020-transaction-lifecycle-semantics.md) |
| 0021    | Prompt Compilation & LLM ACL                       | Accepted | —          | RRP-driven prompt contracts + schema enforcement  | [0021](../../.architecture/decisions/ADR-0021-prompt-compilation-llm-acl.md) |
| 0022    | Server LLM ACL                                     | Accepted | —          | Server-only enforcement patterns                  | [0022](../../.architecture/decisions/ADR-0022-server-llm-acl.md) |
| 0023–0038 | Later ADRs (2026-05)                             | Accepted | 2026-05    | Sync unification, state machines, subpath conventions, local-llm, server markers, etc. | Browse [.architecture/decisions/](../../.architecture/decisions/) |

> **Note:** This index is intentionally curated for human readers. For the complete raw list, see the `.architecture/decisions/` directory.

## How to Add a New ADR

1. Create the next numbered file in `.architecture/decisions/`.
2. Follow the standard ADR template (see [.architecture/README.md](../../.architecture/README.md)).
3. Update this index with a one-line summary and status.
4. Link the ADR from relevant pages in `planning/`, `governance/`, or `architecture/`.

**Full raw list:** Browse [.architecture/decisions/](../../.architecture/decisions/)
