# Architecture Decision Records — Index

This page provides a human-friendly index into the Architecture Decision Records.

**Canonical location of all ADRs:** [.architecture/decisions/](../.architecture/decisions/)

> **Rule:** Full ADR text lives only in `.architecture/decisions/`. This index contains status, one-line summaries, and links.

## Status Legend

- ✅ **Accepted** — Implemented and stable
- 🟡 **In Progress** / Proposed
- ❌ **Superseded** or **Deprecated**

## All ADRs

| ADR       | Title                                     | Status   | Date    | One-Line Summary / Theme                                                                                                                                                       | Link                                                                                   |
| --------- | ----------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 0000      | Next.js with Webpack over Vite            | Accepted | 2026-04 | Build & bundling foundation                                                                                                                                                    | [0000](../.architecture/decisions/ADR-0000-nextjs-webpack-over-vite.md)                |
| 0001      | Persistence Wiring                        | Accepted | —       | Adapter + port approach for storage                                                                                                                                            | [0001](../.architecture/decisions/ADR-0001-persistence-wiring.md)                      |
| 0002      | Sync Engine Structural Fixes              | Accepted | —       | Generator & barrel correctness                                                                                                                                                 | [0002](../.architecture/decisions/ADR-0002-sync-engine-structural-fixes.md)            |
| 0003      | External Project Generation MVP           | Accepted | —       | Initial generator surface                                                                                                                                                      | [0003](../.architecture/decisions/ADR-0003-external-project-generation-mvp.md)         |
| 0004      | CI Build & TypeScript Monorepo Resolution | Accepted | —       | Path mapping & build strategy                                                                                                                                                  | [0004](../.architecture/decisions/ADR-0004-ci-build-typescript-monorepo-resolution.md) |
| 0005      | Shared Kernel Type Migration              | Accepted | —       | Moving common types to @hexagen/shared                                                                                                                                         | [0005](../.architecture/decisions/ADR-0005-shared-kernel-type-migration.md)            |
| 0018      | MVK Semantic Kernel Contracts             | Accepted | 2026-04 | Three-plane contract surface (foundational)                                                                                                                                    | [0018](../.architecture/decisions/ADR-0018-mvk-semantic-kernel-contracts.md)           |
| 0019      | Execution DAG Architecture                | Accepted | 2026-04 | Phase 3 structure (intent + layout + projection)                                                                                                                               | [0019](../.architecture/decisions/ADR-0019-execution-dag-architecture.md)              |
| 0020      | Transaction Lifecycle Semantics           | Accepted | —       | Speculative state, rollback, backpressure                                                                                                                                      | [0020](../.architecture/decisions/ADR-0020-transaction-lifecycle-semantics.md)         |
| 0021      | Prompt Compilation & LLM ACL              | Accepted | —       | RRP-driven prompt contracts + schema enforcement                                                                                                                               | [0021](../.architecture/decisions/ADR-0021-prompt-compilation-llm-acl.md)              |
| 0022      | Server LLM ACL                            | Accepted | —       | Server-only enforcement patterns                                                                                                                                               | [0022](../.architecture/decisions/ADR-0022-server-llm-acl.md)                          |
| 0023–0039 | Later ADRs (2026-05)                      | Accepted | 2026-05 | Sync unification, state machines, subpath conventions, local-llm, server markers, template interpolation / GitHub Actions passthrough, etc.                                    | Browse [.architecture/decisions/](../.architecture/decisions/)                         |
| 0040      | Driver Context is LLM-emittable           | Accepted | 2026-06 | LLM may classify a context as "driver"; extends ADR-0009                                                                                                                       | [0040](../.architecture/decisions/ADR-0040-driver-context-llm-emittable.md)            |
| 0058      | Unconsumed implemented-context deletion   | Accepted | 2026-08 | Active + implemented + zero consumers + no retaining ADR → delete; closes HEX-032 by removing `@hexagen/intent-compiler`                                                       | [0058](../.architecture/decisions/ADR-0058-unconsumed-implemented-context-deletion.md) |
| 0059      | Positioning Capacity Calendar             | Accepted | 2026-08 | Amended 2026-08-18: remaining remediation 6–8 is the active engineering calendar (capacity-freed). Pay-gate / kill-criterion stay FDE product gates only. FDE 3–4 stay parked. | [0059](../.architecture/decisions/ADR-0059-positioning-capacity-calendar.md)           |
| 0060      | Business Versus Consulting                | Accepted | 2026-08 | Business motion: FSL wedge plus hosted paid platform; consulting is a channel, not the company                                                                                 | [0060](../.architecture/decisions/ADR-0060-business-versus-consulting.md)              |
| 0061      | Three-Layer Fair-Source License Split     | Accepted | 2026-08 | FSL wedge / proprietary platform / ToS free tier; FCL only if a self-hosted paid tier is sold                                                                                  | [0061](../.architecture/decisions/ADR-0061-fair-source-license-split.md)               |
| 0062      | README Brownfield Claim and Public Copy   | Accepted | 2026-08 | Public README: brownfield reword, `[commercial]` contact, Hexagen-Monaco casing, drop “never OSS”                                                                              | [0062](../.architecture/decisions/ADR-0062-readme-brownfield-claim-and-public-copy.md) |
| 0063      | Quota Metering Disposition                | Accepted | 2026-08 | Leave metering as-is; signed-in/generate is a subscription-gate question                                                                                                       | [0063](../.architecture/decisions/ADR-0063-quota-metering-disposition.md)              |
| 0064      | Deploy Topology Is Single-Container       | Accepted | 2026-08 | Single-container SQLite topology; k8s must not describe a 2-replica ephemeral cluster                                                                                          | [0064](../.architecture/decisions/ADR-0064-deploy-topology-single-container.md)        |
| 0065      | Single-Container Compose Deployment       | Accepted | 2026-08 | Removed k8s manifests in favor of a single-container compose deployment until Phase 2 multi-tenancy                                                                            | [0065](../.architecture/decisions/ADR-0065-single-container-compose-deployment.md)     |
| 0066      | FSL Wedge and Proprietary Platform        | Accepted | 2026-08 | Extracted drift-check surface as FSL wedge while generator and platform remain proprietary                                                                                     | [0066](../.architecture/decisions/ADR-0066-fsl-wedge-and-proprietary-platform.md)      |

> **Note:** This index is intentionally curated for human readers. For the complete raw list, see the `.architecture/decisions/` directory.

## How to Add a New ADR

1. Create the next numbered file in `.architecture/decisions/`.
2. Follow the standard ADR template (see [.architecture/README.md](../.architecture/README.md)).
3. Update this index with a one-line summary and status.
4. Link the ADR from relevant pages in `planning/`.

**Full raw list:** Browse [.architecture/decisions/](../.architecture/decisions/)
