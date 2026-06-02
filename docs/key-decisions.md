# Key Architectural Decisions

This page synthesizes the most important architectural decisions shaping HexaGen Monaco, along with their rationale, consequences, and current open tensions.

It is designed as a high-signal on-ramp for architects and senior contributors.

## 1. Foundational Topology & Contracts

### Three-Plane Architecture (ADR-0018)

**Decision:** The system is explicitly divided into three isolated planes:

- **Deterministic Kernel** — Semantic truth and execution
- **Projection** — Derived state rendering (UI, layout)
- **Probabilistic** — LLM-driven observation and annotation

**Rationale:** This separation prevents probabilistic noise from corrupting deterministic behavior and allows independent evolution of the layers.

**Consequences:**

- Positive: Clear ownership, easier verification, strong isolation.
- Negative: Requires sophisticated contract surfaces (MVK) and careful boundary enforcement.
- Ongoing: The probabilistic plane is still maturing its interaction model with the kernel.

### MVK as the Semantic Source of Truth

**Decision:** The MVK (Minimal Viable Kernel) specification, rather than the manifest alone, becomes the authoritative contract between planes.

**Current Direction:** Later phases (especially post-Phase 5) are shifting semantic authority from `manifest.yaml` toward MVK.

## 2. Major Implementation Decisions

### Execution DAG Model (ADR-0019)

**Decision:** Phase 3 work was structured as three parallel but coordinated vertical slices (Intent Compiler restructure, Layout Engine, UI Projection Compiler) rather than a single horizontal layer-by-layer build.

**Rationale:** Allowed early end-to-end value while respecting the frozen MVK v1 contracts.

**Trade-offs:** Required very strict MVK discipline from day one to avoid drift.

### Transaction System as First-Class Concern (ADR-0020)

**Decision:** Transactions are not just database operations but first-class architectural citizens with speculative state, backpressure, lineage, and safe rollback semantics.

**Impact:** This decision heavily influenced the design of Phase 4 and the integration points for Phase 5 reconciliation.

## 3. Governance & Enforcement Decisions

### Subpath Conventions + Server Markers (ADRs 0037 and related)

**Decision:** The project adopted strict, machine-enforceable conventions for `client`, `server`, and `shared` exports, backed by the Arch-Linter.

**Key mechanisms:**

- `@hexagen-server-only` markers
- Subpath violation detection
- Package-specific exemptions only where explicitly justified

**Why it matters:** This is one of the primary defenses against kernel logic leaking into the browser bundle.

### Shared Kernel Restraint (ADR-0005 + ongoing)

**Decision:** Only types that are genuinely required for cross-context contracts belong in `@hexagen/shared`.

**Current Tension:** There is ongoing pressure to add more types to the shared kernel for convenience. The discipline is holding but requires active enforcement.

## 4. Open Tensions & Live Questions (2026)

| Tension                        | Description                                                                                                   | Current Lean                                                                              | Owner Area                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| **Authority Migration**        | How much semantic power should move from `manifest.yaml` to MVK?                                              | Gradual shift toward MVK sovereignty after Phase 6                                        | Core team + manifest maintainers   |
| **Composition Root Purity**    | How aggressively should we prevent re-introduction of kernel logic into `app/lib/` after Phase 7?             | Very aggressive (script + ESLint + culture)                                               | App platform + architecture        |
| **Probabilistic Verification** | Should the deterministic kernel re-validate LLM outputs, or is schema enforcement at the boundary sufficient? | Schema + reconciliation at the boundary; selective re-validation only for high-risk paths | Probabilistic layer + verification |
| **ADR Surface Area**           | The current Decisions Index is still abbreviated. Should we invest in a living, high-quality curated index?   | Yes — this `key-decisions.md` + improved `index.md` is the first step                     | Architecture group                 |

## How These Decisions Interconnect

- The **Three-Plane** decision made the **Execution DAG** approach (Phase 3) viable.
- Strong **Transaction** semantics (Phase 4) were a prerequisite for safe **Reconciliation** in the probabilistic layer (Phase 5).
- **Governance enforcement** decisions (subpath + server markers) are the primary mechanism protecting the isolation guarantees of the Three-Plane model.

## Navigation

- Full ADR list and status → [Decisions Index](index.md)
- Authoritative source → [.architecture/decisions/](../.architecture/decisions/)
- Current implementation status → [Core Implementation Overview](../planning/core-implementation/overview.md)
- Governance debt arising from these decisions → [Architectural Governance Debt](../governance/debt.md)

---

_Last significant update: during the docs/ v2 reorganization. This document should be reviewed after any major new ADR is accepted._
