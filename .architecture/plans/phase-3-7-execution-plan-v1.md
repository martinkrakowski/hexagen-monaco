---
plan-id: execution-plan-v1
status: Ready for Execution (pending Phase 3 entry-gate authorization)
authority: Compiled declarative execution plan for Phases 3 through 7
pass-snapshot-sha: TBD-on-commit
phase-range: 3..7
derived-from:
  - .architecture/mvk/spec-v1.md
  - .architecture/mvk/drift-report-v1.md
  - .architecture/decisions/0018-mvk-semantic-kernel-contracts.md
  - .architecture/manifest.yaml
supersedes: None
---

# HexaGen Monaco — Phase 3–7 Execution Plan v1

Declarative, atomic-step plan for the remaining deterministic-kernel,
projection-compiler, transaction, probabilistic-reconciliation, system-verification,
and composition-root-cleanup work.

This document is a **read-only planning artifact**. It does not mutate runtime
state. Execution requires explicit mode transition to Develop Mode per
AGENTS.md §3.

---

## Table of Contents

- Part I — Scope, Identity & Current State Truth
- Part II — Locked Decisions Inherited from Phase 0–1 Plan
- Part III — Remaining Work Classification
- Part IV — Phase Overview (3 → 7)
- Part V — Phase 3 · Execution DAG
- Part VI — Phase 4 · Transaction System (completion)
- Part VII — Phase 5 · Probabilistic Layer
- Part VIII — Phase 6 · System Verification
- Part IX — Phase 7 · Composition-Root Purification (app/lib extraction)
- Part X — Workstream Parallelization Map
- Part XI — Risk Register
- Part XII — Success Metrics & Gates
- Part XIII — Authority Convergence Protocol (M1 → M4)
- Part XIV — Open Items & Authorization Gates

---

## Part I — Scope, Identity & Current State Truth

### I.1 System Identity (unchanged)

HexaGen Monaco is a **compiled, contract-first semantic execution environment**
for UI + AI + geometric constraint systems, organized as a three-plane topology:

| Plane                | Role                                       |
| -------------------- | ------------------------------------------ |
| Deterministic Kernel | Semantic truth, rule resolution, execution |
| Projection           | Render derived state only                  |
| Probabilistic        | Observational validation, annotation       |

### I.2 Completed Work (baseline for this plan)

| Phase                                       | Status      | Commit    |
| ------------------------------------------- | ----------- | --------- |
| Phase 0 · MVK Compilation Pass              | ✅ Complete | `e338e91` |
| Phase 1.1–1.6 · Projection Kernel Isolation | ✅ Complete | `e338e91` |
| Phase 1.7 · Feature Slice Migration         | ✅ Complete | `a1954e7` |

### I.3 Current State Audit (verified at plan authoring time)

**Packages that exist and are operational (28):**

```
agentic-interaction  external-integration  persistence           shared
architectural-enforcement  intent-compiler   project-configuration  sync
code-generation      local-llm             project-generation    transaction-system
core-domain          mcp-server            prompt-compiler       ui
deployment           messaging             reconciliation-engine visualization
                     monaco-orchestration  runtime               web-driver
                                                                 wizard-orchestration
```

**Packages that are scaffolded but need implementation work:**

| Package                 | Phase | Current State                                                                            |
| ----------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `intent-compiler`       | 3     | Flat-structure src/ (no layers yet) — needs DDD restructure + tests                      |
| `transaction-system`    | 4     | Layered scaffold + in-memory adapters present — needs full test parity + real dispatcher |
| `prompt-compiler`       | 5     | Layered scaffold — needs RRP-driven schema generation, real templates                    |
| `reconciliation-engine` | 5     | Layered scaffold — needs verdict comparator, state promoter                              |

**Packages that DO NOT exist yet and must be created:**

| Package                           | Phase | Reason                                                    |
| --------------------------------- | ----- | --------------------------------------------------------- |
| `@hexagen/layout-engine`          | 3     | Constraint solver — geometric layout only, zero semantics |
| `@hexagen/ui-projection-compiler` | 3     | `DomainAST → NodeVisualSpec` mapper                       |

**Deferred legacy code still in `apps/web/app/`:**

| Path                                       | Must migrate to                                     | Owning Phase |
| ------------------------------------------ | --------------------------------------------------- | ------------ |
| `app/lib/layout-engine*`                   | `@hexagen/layout-engine`                            | 3            |
| `app/lib/wizard-to-manifest.ts`            | `@hexagen/wizard-orchestration`                     | 7            |
| `app/lib/compose-wizard-data.ts`           | `@hexagen/wizard-orchestration`                     | 7            |
| `app/lib/grounded-prompt.ts`               | `@hexagen/prompt-compiler`                          | 5            |
| `app/lib/governance-question-templates.ts` | `@hexagen/prompt-compiler`                          | 5            |
| `app/lib/wizard-assistant-context.ts`      | `@hexagen/prompt-compiler`                          | 5            |
| `app/lib/model-recommendation.ts`          | `@hexagen/local-llm`                                | 5            |
| `app/config/models.ts`                     | `@hexagen/local-llm`                                | 5            |
| `app/config/cloud-providers.ts`            | `@hexagen/local-llm`                                | 5            |
| `app/workers/webllm.worker.ts`             | `@hexagen/local-llm` (origin) with reference in app | 5            |

**Remaining legitimate app-level concerns:**

```
app/
├── api/              # Next.js route handlers (must stay — Next.js constraint)
├── architecture-viewer/  # Next.js route
├── providers/        # Composition-root providers (AuthProvider)
├── contexts/         # Cross-feature state (Active Workspace, Export, ExternalIntegration)
├── hooks/            # Cross-cutting providers + cross-feature hooks only
├── lib/              # Will contain only: browser utilities + composition wiring (wire.ts)
├── layout.tsx, page.tsx, globals.css
└── workers/          # Next.js bundling constraint (worker URLs)
```

---

## Part II — Locked Decisions Inherited from Phase 0–1 Plan

Decisions Q1–Q13 remain **authoritative** and are not reopened by this plan.

| #   | Decision                                                 | Impact on Phases 3–7                                                               |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Q1  | Controller hybrid (React Aria + Radix + custom)          | UI Projection Compiler must produce affordances consumable by headless controllers |
| Q2  | 3-layer firewall (TS branded + ESLint + CI)              | Extended to block app/lib kernel leakage in Phase 7                                |
| Q3  | Contracts-first sequencing                               | Phase 3 consumes MVK v1 contracts (frozen)                                         |
| Q4  | Vertical-slice feature folders                           | Layout engine outputs must be consumable per-slice                                 |
| Q5  | State barrier scope (props + internal + imports)         | Phase 7 tightens app/lib imports                                                   |
| Q6  | MVK path convention (`packages/core-domain/src/mvk/v1/`) | No new MVK surface in Phase 3–7; all additions go to their owning package          |
| Q7  | Additive planes overlay                                  | Phases 3–7 register new packages under existing planes                             |
| Q8  | Drift → scaffold order                                   | No new drift pass required; Phase 7 may emit a supplementary drift report          |
| Q9  | Spec-driven + validation-aware                           | Phase 6 validates deterministic hash-stability of all Phase-3 transforms           |
| Q10 | Batched atomic emission allowed                          | Phases 3–5 authorize batching per-package                                          |
| Q11 | Drift alone before spec                                  | Not applicable after Phase 0                                                       |
| Q12 | ADR 0018 binds Phase 0                                   | New ADRs (0019–0022) may be authored per phase                                     |
| Q13 | Co-emission turn grouping                                | Applies to any new compilation pass                                                |

---

## Part III — Remaining Work Classification

### III.1 By Plane

| Plane                    | Remaining work                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deterministic Kernel** | Complete `intent-compiler`, create `layout-engine`, create `ui-projection-compiler`, complete `transaction-system`, extract wizard-orchestration mappers |
| **Projection**           | No new packages — `@hexagen/ui` is complete. NodeVisualSpec consumers wire up in Phase 3                                                                 |
| **Probabilistic**        | Complete `prompt-compiler`, complete `reconciliation-engine`, extract LLM model config into `@hexagen/local-llm`                                         |
| **Composition Root**     | Phase 7 extraction from `apps/web/app/lib/` and `apps/web/app/config/`                                                                                   |
| **Verification**         | Phase 6 — property-based tests, end-to-end DAG, a11y/perf/bundle budgets                                                                                 |

### III.2 By Dependency Order

```
Phase 3  (parallelizable after MVK frozen)
   ├─ 3.A intent-compiler restructure  ┐
   ├─ 3.B layout-engine create         ├─ independent; all consume MVK v1
   └─ 3.C ui-projection-compiler create┘
         │
         ▼
Phase 4  (requires Phase 3)
   └─ transaction-system completion (binds intent + REM + lineage)
         │
         ▼
Phase 5  (requires Phase 4 for state promotion)
   ├─ 5.A prompt-compiler completion (consumes RRP)
   ├─ 5.B LLM adapters (ACL enforcement)
   └─ 5.C reconciliation-engine completion
         │
         ▼
Phase 6  (requires all above)
   └─ System Verification (property tests, E2E, benchmarks)
         │
         ▼
Phase 7  (can run in parallel with Phase 5 since it's composition-root cleanup)
   └─ app/lib + app/config extraction into owning kernel packages
```

---

## Part IV — Phase Overview

| Phase | Name                            | Sizing         | Parallel Ok?                      |
| ----- | ------------------------------- | -------------- | --------------------------------- |
| 3     | Execution DAG                   | L (6–10 weeks) | 3.A/3.B/3.C parallel within phase |
| 4     | Transaction System (completion) | M (3–4 weeks)  | After Phase 3                     |
| 5     | Probabilistic Layer             | L (6–10 weeks) | After Phase 4                     |
| 6     | System Verification             | S (2–4 weeks)  | After Phase 5                     |
| 7     | Composition-Root Purification   | M (3–5 weeks)  | Can run parallel with Phase 5     |

**Execution discipline (applies to every phase)**

Every atomic unit must:

1. Pass `yarn build && yarn typecheck && yarn lint && yarn lint:arch`
2. Be independently committable and reviewable
3. Leave the system in a coherent state if rollback is needed
4. Include its own tests per AGENTS.md §8
5. Update `.architecture/manifest.yaml` BEFORE introducing the TypeScript (manifest-first rule)
6. Run `yarn lint:arch` immediately after manifest edit
7. Emit ADR entry if it introduces a new decision

---

## Part V — Phase 3 · Execution DAG

### V.1 Entry Gate

- ✅ `e338e91` + `a1954e7` present on main
- ✅ `yarn build && yarn typecheck && yarn lint && yarn lint:arch` all green
- ✅ ADR 0019 ("Execution DAG Architecture") drafted before any new package
- ✅ MVK v1 contracts referenced from every new file — no kernel types re-declared

### V.2 Deliverable Summary

```
packages/
├── intent-compiler/        (restructure in place — 3.A)
├── layout-engine/          (NEW — 3.B)
└── ui-projection-compiler/ (NEW — 3.C)
```

Plus:

- `.architecture/decisions/0019-execution-dag-architecture.md`
- Manifest updates: bounded_contexts append + depends_on declarations

### V.3 Phase 3.A — intent-compiler DDD Restructure

#### Entry Preconditions

- Current flat-structure src/ builds and tests (it does per `a1954e7`)
- No downstream consumer exists yet — safe to restructure internals

#### Atomic Units

| Unit   | Deliverable                                                                                                               | Manifest impact                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 3.A.1  | Update manifest.yaml: add layers.domain/application/infrastructure for intent-compiler                                    | bounded_contexts[intent-compiler] expanded |
| 3.A.2  | `yarn lint:arch` after manifest edit                                                                                      | None — must pass                           |
| 3.A.3  | Create `src/domain/gesture.ts` (Gesture entity with id, type, payload, lineage)                                           | —                                          |
| 3.A.4  | Create `src/domain/rejection.ts` (Rejection value object with typed reason union)                                         | —                                          |
| 3.A.5  | Create `src/domain/value-objects/parsed-gesture.ts`                                                                       | —                                          |
| 3.A.6  | Create `src/domain/value-objects/topology-check-result.ts`                                                                | —                                          |
| 3.A.7  | Create `src/domain/value-objects/cardinality-check-result.ts`                                                             | —                                          |
| 3.A.8  | Move `gesture-parser.ts` → `src/infrastructure/adapters/default-gesture-parser.adapter.ts` (implements GestureParserPort) | —                                          |
| 3.A.9  | Move `topology-checker.ts` → `src/infrastructure/adapters/rrp-topology-checker.adapter.ts`                                | —                                          |
| 3.A.10 | Move `cardinality-checker.ts` → `src/infrastructure/adapters/rrp-cardinality-checker.adapter.ts`                          | —                                          |
| 3.A.11 | Move `reject-emitter.ts` → `src/infrastructure/adapters/default-reject-emitter.adapter.ts`                                | —                                          |
| 3.A.12 | Create `src/application/ports/in/{gesture-parser,topology-checker,cardinality-checker,reject-emitter}.port.ts`            | —                                          |
| 3.A.13 | Create `src/application/use-cases/{parse-gesture,validate-topology,validate-cardinality,emit-rejection}.use-case.ts`      | —                                          |
| 3.A.14 | Create `__tests__/doubles/gesture-parser.fake.ts` (+ fakes for other ports)                                               | —                                          |
| 3.A.15 | Convert existing tests to port-based contract tests                                                                       | —                                          |
| 3.A.16 | Update `src/index.ts` barrel to export ports + types (not adapters directly)                                              | —                                          |
| 3.A.17 | Run `yarn sync` to regenerate any stub barrels                                                                            | —                                          |

#### Exit Gate (3.A)

- `yarn build && yarn typecheck && yarn test --filter=@hexagen/intent-compiler` green
- Port-adapter boundaries documented; all tests use fakes
- Zero direct adapter imports from outside `src/infrastructure/`

### V.4 Phase 3.B — layout-engine (NEW package)

#### Entry Preconditions

- 3.A complete (or parallel-ready; no runtime dependency)
- `apps/web/app/lib/layout-engine*` read-only inventory taken

#### Atomic Units

| Unit   | Deliverable                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.B.1  | Update manifest.yaml: add `layout-engine` bounded context under planes.kernel; declare depends_on [core-domain, shared]                                                |
| 3.B.2  | `yarn lint:arch` after manifest edit                                                                                                                                   |
| 3.B.3  | `yarn sync` to scaffold `packages/layout-engine/` with DDD layout                                                                                                      |
| 3.B.4  | `src/domain/value-objects/layout-constraint.ts` (geometric constraints only)                                                                                           |
| 3.B.5  | `src/domain/value-objects/affordance.ts` (typed geometric affordance)                                                                                                  |
| 3.B.6  | `src/domain/value-objects/stability-score.ts`                                                                                                                          |
| 3.B.7  | `src/domain/value-objects/layout-result.ts` (success \| violation)                                                                                                     |
| 3.B.8  | `src/application/ports/in/solve-layout.port.ts`                                                                                                                        |
| 3.B.9  | `src/application/ports/in/resolve-affordance.port.ts`                                                                                                                  |
| 3.B.10 | `src/application/ports/in/score-stability.port.ts`                                                                                                                     |
| 3.B.11 | `src/application/ports/in/detect-violations.port.ts`                                                                                                                   |
| 3.B.12 | `src/application/use-cases/solve-layout.use-case.ts`                                                                                                                   |
| 3.B.13 | `src/application/use-cases/resolve-affordance.use-case.ts`                                                                                                             |
| 3.B.14 | `src/application/use-cases/score-stability.use-case.ts`                                                                                                                |
| 3.B.15 | `src/application/use-cases/detect-violations.use-case.ts`                                                                                                              |
| 3.B.16 | Port in legacy `generateHexagonalContextMap` from `app/lib/layout-engine.ts` as `src/infrastructure/adapters/dagre-layout-solver.adapter.ts` — strip semantic coupling |
| 3.B.17 | `src/infrastructure/adapters/default-affordance-resolver.adapter.ts`                                                                                                   |
| 3.B.18 | `src/infrastructure/adapters/default-stability-scorer.adapter.ts`                                                                                                      |
| 3.B.19 | `src/infrastructure/adapters/default-violation-detector.adapter.ts`                                                                                                    |
| 3.B.20 | `__tests__/doubles/*.fake.ts` for all ports                                                                                                                            |
| 3.B.21 | Property-based tests: layout solver produces feasible output for 100 random DomainAST fixtures                                                                         |
| 3.B.22 | `src/index.ts` barrel — exports ports + types only                                                                                                                     |
| 3.B.23 | Update consumers in `features/hexagon-canvas/hooks/useCanvasState.ts` to import from `@hexagen/layout-engine` (not `@/lib/layout-engine`)                              |
| 3.B.24 | Delete `apps/web/app/lib/layout-engine.ts` + `apps/web/app/lib/layout-engine/`                                                                                         |

#### Exit Gate (3.B)

- Property tests pass on 100+ fixtures
- Zero imports of `@/lib/layout-engine*` remain anywhere in the repo
- Layout solver has zero references to NodeKind, EdgeKind, or any MVK type (only geometric constraints)
- `yarn lint:arch` compliant

### V.5 Phase 3.C — ui-projection-compiler (NEW package)

#### Entry Preconditions

- MVK v1 NodeVisualSpec is frozen
- No runtime dependency on 3.A or 3.B

#### Atomic Units

| Unit   | Deliverable                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| 3.C.1  | Update manifest.yaml: add `ui-projection-compiler` under planes.kernel; depends_on [core-domain, shared]             |
| 3.C.2  | `yarn lint:arch` + `yarn sync`                                                                                       |
| 3.C.3  | `src/domain/value-objects/visual-variant.ts`                                                                         |
| 3.C.4  | `src/domain/value-objects/icon-mapping.ts`                                                                           |
| 3.C.5  | `src/domain/value-objects/projection-error.ts` (typed errors)                                                        |
| 3.C.6  | `src/domain/value-objects/projection-validation-result.ts`                                                           |
| 3.C.7  | `src/application/ports/in/map-node-visual.port.ts`                                                                   |
| 3.C.8  | `src/application/ports/in/resolve-variant.port.ts`                                                                   |
| 3.C.9  | `src/application/ports/in/resolve-icon.port.ts`                                                                      |
| 3.C.10 | `src/application/ports/in/project-affordance.port.ts`                                                                |
| 3.C.11 | `src/application/ports/in/check-realizability.port.ts`                                                               |
| 3.C.12 | `src/application/ports/in/check-affordance-compatibility.port.ts`                                                    |
| 3.C.13 | `src/application/use-cases/*` — one per port                                                                         |
| 3.C.14 | `src/infrastructure/adapters/cva-variant-resolver.adapter.ts` (class-variance-authority integration)                 |
| 3.C.15 | `src/infrastructure/adapters/default-icon-resolver.adapter.ts`                                                       |
| 3.C.16 | `src/infrastructure/adapters/default-node-visual-mapper.adapter.ts`                                                  |
| 3.C.17 | `src/infrastructure/adapters/default-affordance-projector.adapter.ts`                                                |
| 3.C.18 | `src/infrastructure/adapters/default-realizability-checker.adapter.ts`                                               |
| 3.C.19 | `src/infrastructure/adapters/default-affordance-compatibility.adapter.ts`                                            |
| 3.C.20 | `__tests__/doubles/*.fake.ts` — parity with adapters                                                                 |
| 3.C.21 | Snapshot tests: DomainAST fixture → NodeVisualSpec hash-stable                                                       |
| 3.C.22 | Wire consumers: remove hardcoded color/icon maps from `features/hexagon-canvas/BoundedContext.tsx` and related files |

#### Exit Gate (3.C)

- Zero hardcoded PORT_CATEGORY_COLORS, NODE_ICONS, or variant maps remain in feature code
- Reverse validator rejects unrealizable projections pre-render (property-tested)
- `ui-projection-compiler` imports zero runtime, zero projection-framework code (React/xyflow banned)

### V.6 Phase 3 Exit Gate (joint)

- [ ] All three sub-phases (3.A / 3.B / 3.C) exit gates passed
- [ ] End-to-end smoke test: UI gesture → intent-compiler → layout-engine → ui-projection-compiler → canvas render
- [ ] ADR 0019 finalized (published, not draft)
- [ ] `yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test` green
- [ ] Architectural compliance with manifest.yaml verified (no new violations)

---

## Part VI — Phase 4 · Transaction System (completion)

### VI.1 Entry Gate

- ✅ Phase 3 exit gate passed
- ✅ MVK RRP + REM available as types (Phase 0 delivered this)
- ✅ intent-compiler produces DomainCommand reliably (Phase 3.A delivered this)

### VI.2 Current State Audit

`packages/transaction-system/` has:

- `src/domain/transaction.ts` (partial)
- `src/application/ports/in/{transaction-manager,speculative-state-machine,backpressure-controller,semantic-cache}.port.ts`
- `src/infrastructure/adapters/in-memory-*.adapter.ts` (all four)
- Tests exist for adapters

What's missing:

- Speculative state machine monotonicity proofs
- Backpressure coalescing contract
- Semantic cache key derivation spec
- Transaction rollback semantics for stale REM
- Intent lineage propagation throughout transaction lifecycle

### VI.3 Atomic Units

| Unit | Deliverable                                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | ADR 0020 — Transaction Lifecycle & Speculative State Semantics                                                                    |
| 4.2  | `src/domain/value-objects/transaction-id.ts` with stable hash contract                                                            |
| 4.3  | `src/domain/value-objects/speculative-state.ts` — discriminated union (pending/confirmed/reconciled/discarded)                    |
| 4.4  | `src/domain/value-objects/backpressure-signal.ts`                                                                                 |
| 4.5  | `src/domain/value-objects/cache-entry.ts` with explicit exclusion list (spatial, transient)                                       |
| 4.6  | `src/application/use-cases/execute-transaction.use-case.ts` — binds intent + REM + lineage                                        |
| 4.7  | `src/application/use-cases/rollback-transaction.use-case.ts` — handles stale REM recovery                                         |
| 4.8  | `src/application/use-cases/commit-transaction.use-case.ts` — promotes speculative → confirmed                                     |
| 4.9  | `src/application/use-cases/query-cache.use-case.ts`                                                                               |
| 4.10 | Upgrade `in-memory-speculative-state-machine.adapter.ts` — enforce monotonicity invariant                                         |
| 4.11 | Upgrade `in-memory-backpressure-controller.adapter.ts` — implement intent coalescing, ephemeral dropping, fidelity degradation    |
| 4.12 | Upgrade `in-memory-semantic-cache.adapter.ts` — cache key = hash(normalized DomainAST + RRP version); exclude non-semantic inputs |
| 4.13 | Upgrade `in-memory-transaction-manager.adapter.ts` — orchestrate all above                                                        |
| 4.14 | Property test: no rollback path produces inconsistent SpeculativeState                                                            |
| 4.15 | Property test: cache hit rate ≥ target on representative workload                                                                 |
| 4.16 | Property test: intent coalescing does not drop semantically distinct intents                                                      |
| 4.17 | Integration test: transaction flow with simulated backpressure                                                                    |

### VI.4 Exit Gate

- [ ] All property tests pass (1000+ generated scenarios)
- [ ] Throughput benchmark meets SLA under coalescing (to be defined in ADR 0020)
- [ ] ADR 0020 finalized
- [ ] Cache key excludes all transient/spatial data (verified by property test)

---

## Part VII — Phase 5 · Probabilistic Layer

### VII.1 Entry Gate

- ✅ Phase 4 exit gate passed
- ✅ RRP is stable (referenced from Phase 0 + Phase 4)

### VII.2 Phase 5.A — Prompt Compiler Completion

#### Atomic Units

| Unit   | Deliverable                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.A.1  | ADR 0021 — Prompt Compilation & LLM ACL Enforcement                                                                                                  |
| 5.A.2  | `src/domain/value-objects/system-instruction.ts`                                                                                                     |
| 5.A.3  | `src/domain/value-objects/structured-output-schema.ts` (Zod-backed)                                                                                  |
| 5.A.4  | `src/domain/value-objects/prompt-cache-key.ts`                                                                                                       |
| 5.A.5  | `src/application/ports/in/build-system-instruction.port.ts` (RRP → prompt)                                                                           |
| 5.A.6  | `src/application/ports/in/generate-zod-schema.port.ts` (RRP → Zod schema)                                                                            |
| 5.A.7  | `src/application/ports/in/cache-prompt.port.ts`                                                                                                      |
| 5.A.8  | `src/application/use-cases/compile-prompt.use-case.ts`                                                                                               |
| 5.A.9  | `src/application/use-cases/render-prompt.use-case.ts`                                                                                                |
| 5.A.10 | `src/application/use-cases/cache-prompt.use-case.ts`                                                                                                 |
| 5.A.11 | `src/infrastructure/adapters/rrp-system-instruction-builder.adapter.ts`                                                                              |
| 5.A.12 | `src/infrastructure/adapters/rrp-zod-schema-generator.adapter.ts`                                                                                    |
| 5.A.13 | `src/infrastructure/adapters/in-memory-prompt-cache.adapter.ts`                                                                                      |
| 5.A.14 | Snapshot tests: identical RRP inputs → identical compiled prompt hashes                                                                              |
| 5.A.15 | Migrate `apps/web/app/lib/grounded-prompt.ts` → `packages/prompt-compiler/src/infrastructure/adapters/grounded-prompt-builder.adapter.ts`            |
| 5.A.16 | Migrate `apps/web/app/lib/governance-question-templates.ts` → `packages/prompt-compiler/src/domain/governance-question-templates.ts`                 |
| 5.A.17 | Migrate `apps/web/app/lib/wizard-assistant-context.ts` → `packages/prompt-compiler/src/infrastructure/adapters/wizard-context-serializer.adapter.ts` |
| 5.A.18 | Update all consumers (primarily `features/governance-assistant/hooks/`) to import from `@hexagen/prompt-compiler`                                    |

### VII.3 Phase 5.B — LLM Adapters (ACL enforcement)

#### Atomic Units

| Unit   | Deliverable                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 5.B.1  | `packages/local-llm/src/application/ports/in/send-structured-request.port.ts` — accepts ONLY (prompt, schema); never raw UI events      |
| 5.B.2  | `packages/local-llm/src/domain/value-objects/llm-request.ts`                                                                            |
| 5.B.3  | `packages/local-llm/src/domain/value-objects/llm-response.ts`                                                                           |
| 5.B.4  | `packages/local-llm/src/domain/value-objects/schema-validation-result.ts`                                                               |
| 5.B.5  | Refactor existing `webllm-adapter` to implement the new port; add Zod schema validation at response boundary                            |
| 5.B.6  | Refactor existing `cloud-llm-adapter` similarly                                                                                         |
| 5.B.7  | Reject-on-schema-drift: hard failure if response does not validate                                                                      |
| 5.B.8  | Move `apps/web/app/config/models.ts` → `packages/local-llm/src/domain/model-catalog.ts`                                                 |
| 5.B.9  | Move `apps/web/app/config/cloud-providers.ts` → `packages/local-llm/src/domain/cloud-provider-catalog.ts`                               |
| 5.B.10 | Move `apps/web/app/lib/model-recommendation.ts` → `packages/local-llm/src/application/use-cases/recommend-model.use-case.ts`            |
| 5.B.11 | Keep `apps/web/app/workers/webllm.worker.ts` at app-level (Next.js bundling constraint) but import core logic from `@hexagen/local-llm` |
| 5.B.12 | Property test: no LLM input path bypasses prompt-compiler's schema generation                                                           |

### VII.4 Phase 5.C — Reconciliation Engine Completion

#### Atomic Units

| Unit   | Deliverable                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| 5.C.1  | `src/domain/value-objects/verdict.ts` (heuristic verdict discriminated union)                                 |
| 5.C.2  | `src/domain/value-objects/reconciliation-state.ts` (pending/confirmed/reconciled/rejected)                    |
| 5.C.3  | `src/application/ports/in/compare-verdicts.port.ts`                                                           |
| 5.C.4  | `src/application/ports/in/promote-state.port.ts`                                                              |
| 5.C.5  | `src/application/ports/in/resolve-conflict.port.ts`                                                           |
| 5.C.6  | `src/application/use-cases/compare-verdicts.use-case.ts`                                                      |
| 5.C.7  | `src/application/use-cases/promote-state.use-case.ts`                                                         |
| 5.C.8  | `src/application/use-cases/resolve-conflict.use-case.ts`                                                      |
| 5.C.9  | `src/infrastructure/adapters/default-verdict-comparator.adapter.ts`                                           |
| 5.C.10 | `src/infrastructure/adapters/monotonic-state-promoter.adapter.ts`                                             |
| 5.C.11 | `src/infrastructure/adapters/default-conflict-resolver.adapter.ts` — LLM NEVER overrides deterministic kernel |
| 5.C.12 | Property test: state transitions are monotonic                                                                |
| 5.C.13 | Property test: no LLM output bypasses deterministic kernel                                                    |

### VII.5 Phase 5 Exit Gate

- [ ] LLM outputs validated against Zod schema at 100% rate (measured over 1000 test runs)
- [ ] Reconciliation state transitions are provably monotonic
- [ ] All `app/config/*` and `app/lib/*-prompt*` / `model-recommendation*` files migrated
- [ ] ADR 0021 finalized

---

## Part VIII — Phase 6 · System Verification

### VIII.1 Entry Gate

- ✅ Phases 3, 4, 5 exit gates passed
- ✅ Phase 7 can run in parallel (does not block verification)

### VIII.2 Atomic Units

| Unit | Deliverable                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 6.1  | `packages/core-domain/__tests__/property/domain-ast-invariants.property.test.ts` — 1000+ generated scenarios                               |
| 6.2  | `packages/core-domain/__tests__/property/rrp-determinism.property.test.ts` — identical inputs → identical hashes                           |
| 6.3  | Compile-time exhaustiveness check for every discriminated union (NodeKind, EdgeKind, DomainCommand, SpeculativeState, ReconciliationState) |
| 6.4  | `packages/layout-engine/__tests__/property/feasibility.property.test.ts` — provable layout exists for sampled domains                      |
| 6.5  | End-to-end regression: wizard → canvas → governance → export (Playwright recommended)                                                      |
| 6.6  | Accessibility audit script: axe-core scan of apps/web; gate at AA across all features                                                      |
| 6.7  | Bundle size benchmark: `@hexagen/ui` < 50KB gzip; `apps/web` First Load JS ≤ declared budget                                               |
| 6.8  | Canvas performance: 60 fps under 100-node graph (measured via Playwright trace)                                                            |
| 6.9  | LLM schema-drift regression: 0% drift rate over N=1000 live-ish runs (using test doubles)                                                  |
| 6.10 | Doc pass: update `README.md`, every package README, and `.architecture/README.md` to reflect Phase 3–7 state                               |

### VIII.3 Exit Gate

- [ ] All property tests pass across 1000+ generated scenarios per suite
- [ ] Bundle size + a11y + performance meet declared SLAs
- [ ] All `.architecture/` docs updated
- [ ] Final ADR 0022 ("System Verification v1 Results") published

---

## Part IX — Phase 7 · Composition-Root Purification

### IX.1 Purpose

Complete the deferred work from Phase 1.7 by extracting kernel/probabilistic
code from `apps/web/app/lib/` and `apps/web/app/config/` into their owning
packages. This phase can run **in parallel with Phase 5** since most targets
are packages that Phase 5 is already touching.

### IX.2 Entry Gate

- Phase 5.A + 5.B completion (provides target packages for migrations)
- OR Phase 5 is in progress — safe to do migrations incrementally as Phase 5.A and 5.B open their packages for writes

### IX.3 Atomic Units

| Unit | Source (delete after)                                                                                                                      | Target                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 7.1  | `apps/web/app/lib/grounded-prompt.ts`                                                                                                      | `@hexagen/prompt-compiler` (covered in 5.A.15)                                               |
| 7.2  | `apps/web/app/lib/governance-question-templates.ts`                                                                                        | `@hexagen/prompt-compiler` (5.A.16)                                                          |
| 7.3  | `apps/web/app/lib/wizard-assistant-context.ts`                                                                                             | `@hexagen/prompt-compiler` (5.A.17)                                                          |
| 7.4  | `apps/web/app/lib/model-recommendation.ts`                                                                                                 | `@hexagen/local-llm` (5.B.10)                                                                |
| 7.5  | `apps/web/app/config/models.ts`                                                                                                            | `@hexagen/local-llm` (5.B.8)                                                                 |
| 7.6  | `apps/web/app/config/cloud-providers.ts`                                                                                                   | `@hexagen/local-llm` (5.B.9)                                                                 |
| 7.7  | `apps/web/app/lib/layout-engine.ts` + `app/lib/layout-engine/`                                                                             | `@hexagen/layout-engine` (covered in 3.B.16)                                                 |
| 7.8  | `apps/web/app/lib/wizard-to-manifest.ts`                                                                                                   | `@hexagen/wizard-orchestration/src/application/use-cases/map-wizard-to-manifest.use-case.ts` |
| 7.9  | `apps/web/app/lib/compose-wizard-data.ts`                                                                                                  | `@hexagen/wizard-orchestration/src/application/use-cases/compose-wizard-data.use-case.ts`    |
| 7.10 | `apps/web/app/workers/webllm.worker.ts` (keep at app-level but thin)                                                                       | Core logic imported from `@hexagen/local-llm`                                                |
| 7.11 | Extend `scripts/validate-ui-boundary.sh` with a new section: forbid kernel-logic imports in `apps/web/app/lib/` and `apps/web/app/config/` |
| 7.12 | Extend root ESLint: `no-restricted-imports` pattern on `apps/web/app/lib/**` preventing re-introduction of kernel logic                    |
| 7.13 | Document permissible `app/lib/` contents in `apps/web/README.md` (browser utils + composition wiring only)                                 |

### IX.4 Post-Migration State of `apps/web/app/lib/`

```
app/lib/
├── download-blob.ts         # browser-only utility
├── fetch-json.ts            # browser-only utility
├── language-utils.ts        # browser-only utility
├── persisted-state.ts       # browser-only utility
├── tree-utils.ts            # browser-only utility
├── utils.ts                 # browser-only utility
├── wire.ts                  # composition-root DI wiring
└── wire.project-generation.ts  # composition-root DI wiring
```

### IX.5 Exit Gate

- [ ] Zero files in `apps/web/app/lib/` import from any `@hexagen/*` kernel package (verified by Layer 3 script)
- [ ] `apps/web/app/config/` deleted
- [ ] `scripts/validate-ui-boundary.sh` enforces the above
- [ ] All consumers updated to import from `@hexagen/*` packages
- [ ] `yarn build && yarn typecheck && yarn lint && yarn lint:arch` green

---

## Part X — Workstream Parallelization Map

```
           Phase 0 + 1 COMPLETE (frozen baseline)
                       │
                       ▼
         ┌─────────────┴──────────────┐
         │    Phase 3 · Execution DAG │
         │ (3.A/3.B/3.C parallel ok)  │
         └─────────────┬──────────────┘
                       │
                       ▼
         ┌─────────────────────────────┐
         │    Phase 4 · Transactions   │
         └─────────────┬───────────────┘
                       │
         ┌─────────────┴────────────────────────┐
         │                                       │
         ▼                                       ▼
┌─────────────────────┐                  ┌────────────────────┐
│    Phase 5          │ ── PARALLEL ──► │  Phase 7           │
│ Probabilistic Layer │                  │ App-lib extraction │
└─────────────┬───────┘                  └────────┬───────────┘
              │                                   │
              └───────────────┬───────────────────┘
                              ▼
              ┌───────────────────────────┐
              │   Phase 6 · Verification  │
              └───────────────────────────┘
```

**Coordination rules:**

- Any package touched by both Phase 5 and Phase 7 requires joint PR
- A single "contract freeze" happens at Phase 5 exit for LLM schemas
- `yarn sync --force` runs after any manifest edit; regenerates barrels

---

## Part XI — Risk Register

### XI.1 Technical Risks

| #     | Risk                                                      | Severity | Owning Phase | Mitigation                                                                                   |
| ----- | --------------------------------------------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------- |
| TR-9  | Restructuring intent-compiler breaks existing consumers   | High     | 3.A          | No consumers exist yet — scheduled first                                                     |
| TR-10 | Layout engine encodes implicit semantics                  | Critical | 3.B          | Property test: inputs contain only geometric data; TS type-level check bans NodeKind imports |
| TR-11 | UI projection compiler hardcodes framework types (React)  | High     | 3.C          | ESLint rule: no react imports in projection-compiler package                                 |
| TR-12 | Transaction cache leaks non-semantic state                | Critical | 4            | Cache-key includes explicit exclusion list; property test enforces                           |
| TR-13 | LLM bypasses Zod validation under streaming               | Critical | 5.B          | Validator wraps every chunk; on-error transaction rolls back                                 |
| TR-14 | Wizard-orchestration migration breaks wizard form imports | High     | 7            | Migrate imports slice-by-slice; type-check after each                                        |
| TR-15 | `yarn sync` breaks existing barrels                       | Medium   | any          | Run `yarn sync --dry-run` first; commit as separate step                                     |
| TR-16 | Extraction misses a consumer, leaves orphan import        | High     | 7            | Pre-migration grep audit; post-migration `yarn typecheck` gate                               |

### XI.2 Architectural Risks

| #     | Risk                                                                                 | Severity |
| ----- | ------------------------------------------------------------------------------------ | -------- |
| AR-6  | Phase 3 introduces duplicate type declarations (own NodeKind vs MVK NodeKind)        | Critical |
| AR-7  | Phase 4 transactions accept raw UI events                                            | Critical |
| AR-8  | Phase 5 LLM adapter receives RRP directly (bypassing prompt-compiler)                | Critical |
| AR-9  | Phase 7 leaves composition-wire still kernel-aware (acceptable) vs depends_on bypass | Medium   |
| AR-10 | Cross-feature imports between slices introduced during migration                     | High     |

### XI.3 Operational Risks

| #    | Risk                                                           | Severity |
| ---- | -------------------------------------------------------------- | -------- |
| OR-4 | Turbo cache holds stale build during restructure               | Medium   |
| OR-5 | pre-commit hook SIGKILL on large migrations (already observed) | Medium   |
| OR-6 | `yarn sync` file-writes collide with uncommitted edits         | Low      |

---

## Part XII — Success Metrics & Gates

### XII.1 Per-Phase Gates (Enforced)

| Phase | Required Command(s)                                                 | Required Result                        |
| ----- | ------------------------------------------------------------------- | -------------------------------------- |
| All   | `yarn build && yarn typecheck && yarn lint && yarn lint:arch`       | Green                                  |
| 3.A   | `yarn test --filter=@hexagen/intent-compiler`                       | ≥ 95% coverage on domain + application |
| 3.B   | Property test: `yarn test --filter=@hexagen/layout-engine`          | 1000 fixtures pass                     |
| 3.C   | Property test: `yarn test --filter=@hexagen/ui-projection-compiler` | Hash-stable snapshots                  |
| 4     | Property test: monotonicity, cache key derivation                   | 1000 scenarios pass                    |
| 5     | LLM schema-drift test                                               | 0% drift over 1000 runs                |
| 6     | axe AA audit, bundle budget, fps trace                              | All meet SLA                           |
| 7     | UI boundary check extended                                          | No new violations                      |

### XII.2 System-Level KPIs (tracked through Phase 6)

| KPI                                                                 | Target                      |
| ------------------------------------------------------------------- | --------------------------- |
| MVK contract churn post-Phase-6                                     | < 1 breaking change / month |
| Type coverage in core-domain, layout-engine, ui-projection-compiler | 100% (zero `any`)           |
| Feature slice isolation                                             | 0 cross-slice imports       |
| LLM schema drift rate                                               | 0%                          |
| RRP determinism                                                     | 100% hash stability         |
| app/lib kernel leakage                                              | 0 kernel imports            |
| Bundle size (@hexagen/ui)                                           | < 50KB gzip                 |
| Canvas performance                                                  | 60fps / 100-node            |
| a11y audit                                                          | AA across all features      |

---

## Part XIII — Authority Convergence Protocol (M1 → M4)

Semantic-authority migration from Phase 0's dual-truth (manifest.yaml + MVK) to
MVK sovereignty.

| Milestone | Trigger                 | Semantic Authority              | manifest.yaml Role                  |
| --------- | ----------------------- | ------------------------------- | ----------------------------------- |
| M1        | Phase 0 exit (baseline) | manifest + MVK (dual)           | Execution topology + planes overlay |
| M2        | Phase 3 exit            | MVK primary, manifest secondary | Deployment topology                 |
| M3        | Phase 4 exit            | MVK sovereign                   | Infrastructure metadata only        |
| M4        | Phase 6 exit            | MVK exclusive                   | Deprecated for semantics            |

Dual-truth resolution rules (M1 → M3):

1. If MVK ↔ manifest disagree on a bounded context → manifest wins at M1; MVK wins at M2+
2. Any divergence must emit an ADR entry
3. No new semantic features added to manifest after M2
4. manifest.yaml semantic fields are deprecated when (a) MVK expresses same concept, (b) two consumers migrated, (c) deprecation ADR filed, (d) one release-cycle warning header

---

## Part XIV — Open Items & Authorization Gates

### XIV.1 Remaining Open Items

| #    | Item                                                             | Blocker Type                     |
| ---- | ---------------------------------------------------------------- | -------------------------------- |
| OI-1 | ADR 0019 draft (Execution DAG Architecture)                      | Document decision, not execution |
| OI-2 | ADR 0020 draft (Transaction Lifecycle Semantics)                 | Phase 4 entry                    |
| OI-3 | ADR 0021 draft (Prompt Compilation & LLM ACL)                    | Phase 5 entry                    |
| OI-4 | ADR 0022 draft (System Verification v1)                          | Phase 6 exit                     |
| OI-5 | Performance SLA definition (60fps @ N-nodes; N=?)                | Phase 6 entry                    |
| OI-6 | Bundle budget definition (First Load JS ≤ ?)                     | Phase 6 entry                    |
| OI-7 | Extend `scripts/validate-ui-boundary.sh` for app/lib enforcement | Phase 7 entry                    |

### XIV.2 Authorization Required to Proceed

To move from Plan Mode to Phase 3 execution, the following must be provided:

1. Explicit Plan Mode exit statement from human
2. Mode declaration for execution (Architect to draft ADR 0019, then Develop to build)
3. Performance & bundle SLAs signed off
4. (Optional) feature branch name preference (else default `feature/phase-3-execution-dag`)

### XIV.3 Current State Summary

- ✅ Plan complete — all phases, atomic units, and gates enumerated
- ✅ Dependencies between phases explicit
- ✅ Parallelization opportunities identified
- ✅ Risk register complete
- ⏸ Execution blocked — awaiting authorization + ADR 0019 draft

---

## Appendix A — Atomic Unit Template

Every atomic unit in this plan, when executed, produces a commit matching this
template:

```
<type>(<package>): <unit-id> <short description>

<Body describes the atomic change: what file(s) added/modified, what contract
introduced or refined, any manifest update, any ADR cross-reference.>

Unit: <phase.subphase.unit>
Manifest impact: <none | bounded_contexts[<name>] updated>
ADR: <N/A | 00XX>
Tests: <added | updated | n/a>

Verification
- yarn build ✓
- yarn typecheck ✓
- yarn lint ✓
- yarn lint:arch ✓
- yarn test --filter=<scope> ✓
```

---

## Appendix B — Package Plane Assignments (post Phase 7)

| Plane                      | Packages                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kernel (Deterministic)** | core-domain, runtime, intent-compiler, layout-engine, ui-projection-compiler, transaction-system, wizard-orchestration, architectural-enforcement, project-configuration, project-generation, code-generation, monaco-orchestration |
| **Projection**             | ui, visualization, web-driver                                                                                                                                                                                                       |
| **Probabilistic**          | local-llm, agentic-interaction, mcp-server, prompt-compiler, reconciliation-engine                                                                                                                                                  |
| **Infrastructure**         | persistence, messaging, external-integration, deployment, sync                                                                                                                                                                      |
| **Shared Kernel**          | shared                                                                                                                                                                                                                              |
| **Apps**                   | web, api-gateway, tui                                                                                                                                                                                                               |

---

END OF PHASE 3–7 EXECUTION PLAN v1
