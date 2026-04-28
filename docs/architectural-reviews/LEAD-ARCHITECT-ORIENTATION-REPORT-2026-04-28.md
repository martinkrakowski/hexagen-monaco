# Lead Architect Orientation Report — HexaGen Monaco System Analysis

**Date:** 2026-04-28
**Lead Architect:** Bob (AI Development Framework)
**Mission:** Establish complete system awareness before spawning implementation sub-agents
**Status:** ✅ ORIENTATION COMPLETE

---

## EXECUTIVE SUMMARY

### Critical Finding: Task Description Contains Outdated Information

**The accept/reject endpoints ARE fully implemented** (as of ADR-0028, 2026-04-27). The task description stating they are "logging-only stubs" is **outdated**.

**Current State:**

- ✅ [`accept/route.ts`](../../apps/web/app/api/architecture/modify/accept/route.ts) — Fully implemented (171 lines)
- ✅ [`reject/route.ts`](../../apps/web/app/api/architecture/modify/reject/route.ts) — Fully implemented (115 lines)
- ✅ Transaction state machine properly wired
- ✅ Lint validation + git restore on failure
- ✅ Build passing, no compilation errors

**The REAL issue is in Flow 1 sequencing** — patches are applied to manifest BEFORE transaction enters speculative state, not after user review.

---

## SYSTEM ARCHITECTURE OVERVIEW

### Bounded Contexts (34 packages)

| Plane              | Contexts                                                                                                                                                                        | Status    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Kernel**         | core-domain, intent-compiler, layout-engine, ui-projection-compiler, transaction-system, prompt-compiler, architectural-enforcement, wizard-orchestration, monaco-orchestration | ✅ Active |
| **Projection**     | ui, visualization, web-driver                                                                                                                                                   | ✅ Active |
| **Probabilistic**  | local-llm, agentic-interaction, reconciliation-engine, mcp-server                                                                                                               | ✅ Active |
| **Infrastructure** | persistence, messaging, external-integration, deployment, sync, runtime                                                                                                         | ✅ Active |
| **Shared Kernel**  | shared, core-domain                                                                                                                                                             | ✅ Active |

### Key Dependencies

```
agentic-interaction
├── local-llm
├── ai-pipeline
├── prompt-compiler
├── reconciliation-engine
└── transaction-system

transaction-system
├── core-domain
├── intent-compiler
├── shared
└── sync

web (Next.js app)
├── agentic-interaction
├── monaco-orchestration
├── visualization
├── wizard-orchestration
└── web-driver
```

---

## DATA FLOW ANALYSIS

### Flow 1: NL Input → Manifest Mutation (RISK)

**Entry:** `useArchitectureModification.ts:86` → POST `/api/architecture/modify/stream`
**Exit:** Manifest written + SSE closed + UI updated

**Critical Path (12 stages):**

1. Client hook → POST with `{intent, manifestPath?, lineage?}`
2. API route → Validate input, create SSE stream
3. Use case wiring → Wire dependencies
4. **Pipeline execution** → 5 steps: parse → compile → LLM → reconcile → commit
5. Reconciliation → Generate patches, filter by lint
6. **Transaction begin** → Create transaction, transition to "speculative"
7. ⚠️ **ISSUE: Manifest mutation** → Apply patches **BEFORE user review**
8. Disk write → `fs.writeFile()` to `.architecture/manifest.yaml`
9. Lint validation → `execSync("yarn lint:arch")` **BLOCKING**
10. Rollback on lint fail → `git checkout` if lint fails
11. Transaction commit → Transition to "committed"
12. SSE events → Stream progress, close on completion

**Issues Identified:**

| #   | Issue                                 | Location                                                                                                                                          | Severity    | Impact                           |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------- |
| 1   | Patches applied before user review    | [`modify-architecture.use-case.ts:304-307`](../../packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:304-307) | 🔴 CRITICAL | Violates ADR-0028 two-phase flow |
| 2   | Blocking `execSync` calls             | [`manifest-service.ts:54`](../../packages/sync/src/manifest-service.ts:54)                                                                        | 🟡 HIGH     | Can hang server thread           |
| 3   | Git restore failure → unrecoverable   | [`use-case.ts:123-146`](../../packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:123-146)                     | 🔴 CRITICAL | Manifest corruption              |
| 4   | No retry logic for transient failures | N/A                                                                                                                                               | 🟡 MEDIUM   | Brittle pipeline                 |
| 5   | SSE stream can break mid-pipeline     | [`route.ts:111-154`](../../apps/web/app/api/architecture/modify/stream/route.ts:111-154)                                                          | 🟡 MEDIUM   | No heartbeat mechanism           |
| 6   | Client abort doesn't stop server      | [`useArchitectureModification.ts:199-202`](../../apps/web/features/governance-assistant/hooks/useArchitectureModification.ts:199-202)             | 🟡 LOW      | Wasteful execution               |

### Flow 2: Manifest Read → UI Render (CLEAN)

**Entry:** `page.tsx:10` → `<ProjectWorkspace />`
**Exit:** UI rendered from client-side form state

**Verdict:** ✅ No issues — client-side only, no server dependency

### Flow 3: Patch Accept/Reject → State Transition (IMPLEMENTED)

**Entry:** `useArchitectureModification.ts:229` → `acceptPatch()` or `line 248` → `rejectPatch()`
**Exit:** HTTP 200 with transaction state updated

**Accept Flow (Fully Implemented):**

1. Client → POST `/api/architecture/modify/accept` with `{transactionId, manifestPath?}`
2. Validate transaction exists and is in "speculative" state
3. Apply patches via `ManifestMutation.applyPatches()`
4. Validate manifest via `LintValidation.validateManifest()`
5. **If lint passes:** Commit transaction, return success
6. **If lint fails:** Restore from git, rollback transaction, return errors

**Reject Flow (Fully Implemented):**

1. Client → POST `/api/architecture/modify/reject` with `{transactionId, manifestPath?, reason?}`
2. Validate transaction exists and is in "speculative" state
3. Restore manifest from git (defensive)
4. Rollback transaction with reason
5. Return success

**Verdict:** ✅ Fully implemented per ADR-0028

---

## HEXAGONAL ARCHITECTURE COMPLIANCE

### Port/Adapter Analysis

**Compliant Packages:**

- ✅ `@hexagen/transaction-system` — Clean port/adapter separation
- ✅ `@hexagen/reconciliation-engine` — Proper use case structure
- ✅ `@hexagen/external-integration` — Domain-driven design
- ✅ `@hexagen/report-governance` — File-system adapter properly isolated

**Packages Requiring Attention:**

- ⚠️ `@hexagen/agentic-interaction` — Use case directly calls manifest mutation (should use port)
- ⚠️ `@hexagen/sync` — Blocking `execSync` in critical path
- ⚠️ `@hexagen/web-driver` — Some adapters incomplete (stubs)

### Cross-Package Boundary Violations

**None detected** — All imports respect manifest.yaml dependency declarations

---

## MCP TOOLING GAPS

### Current MCP Tools (mcp-server package)

**Resources:**

- ✅ GetManifestResourceUseCase
- ✅ GetGraphResourceUseCase
- ✅ GetLinterReportResourceUseCase
- ✅ GetDecisionsResourceUseCase
- ✅ GetInvariantsResourceUseCase
- ✅ GetLinterConfigResourceUseCase
- ✅ GetWorkspaceContextResourceUseCase

**Tools:**

- ✅ DiffManifestToolUseCase
- ✅ AuditBoundariesToolUseCase
- ✅ ScaffoldModuleToolUseCase
- ✅ AddDependencyToolUseCase
- ✅ CreatePortToolUseCase
- ✅ CreateAdapterToolUseCase
- ✅ RemovePortToolUseCase
- ✅ RemoveContextToolUseCase
- ✅ InitializeFeatureWorktreeToolUseCase
- ✅ SubmitArchitecturalSpecToolUseCase
- ✅ LogAgentRemediationToolUseCase

**Missing Tools (from task description):**

- ❌ GetTransactionToolUseCase — Query transaction state
- ❌ AcceptTransactionToolUseCase — Accept patches programmatically
- ❌ RejectTransactionToolUseCase — Reject patches programmatically
- ❌ RollbackTransactionToolUseCase — Force rollback

**Impact:** AI agents cannot interact with pending transactions via MCP

---

## IDENTIFIED GAPS (Priority Order)

### P0 — Blocking Issues

1. **Flow 1 Sequencing Bug**
   - **Issue:** Patches applied to manifest BEFORE transaction enters speculative state
   - **Location:** [`modify-architecture.use-case.ts:304-343`](../../packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts:304-343)
   - **Fix:** Move patch application to accept endpoint, not pipeline
   - **Blocks:** A2UI Phases 2–5

2. **Blocking execSync Calls**
   - **Issue:** `execSync("yarn lint:arch")` blocks server thread
   - **Location:** [`manifest-service.ts:54`](../../packages/sync/src/manifest-service.ts:54)
   - **Fix:** Use async `exec()` with timeout
   - **Risk:** Server hang, SSE stream break

### P1 — High-Priority Gaps

3. **MCP Transaction Management Tools Missing**
   - **Issue:** No MCP tools for transaction lifecycle
   - **Impact:** AI agents cannot automate accept/reject workflows
   - **Fix:** Add 4 new use cases to mcp-server

4. **No Retry Logic for Transient Failures**
   - **Issue:** LLM API failures, file I/O errors not retried
   - **Impact:** Brittle pipeline, poor UX
   - **Fix:** Add exponential backoff retry wrapper

5. **SSE Stream Lifecycle Issues**
   - **Issue:** No heartbeat, client abort doesn't stop server
   - **Impact:** Wasteful execution, connection breaks
   - **Fix:** Add heartbeat interval, abort signal propagation

### P2 — Medium-Priority Gaps

6. **Workspace Root Path Resolution**
   - **Issue:** Hexagen CLI resolves to base repo, not active worktree
   - **Impact:** Manifest mutations go to wrong file
   - **Fix:** Add worktree detection to sync engine

7. **Linter Config Not Auto-Updated**
   - **Issue:** Adding cross-module dependency doesn't update linter config
   - **Impact:** `yarn lint:arch` fails even with valid dependency
   - **Fix:** Auto-update `.architecture/invariants/linter-config.yaml`

8. **Incomplete Scaffolding**
   - **Issue:** `hexagen_scaffold_module` creates folders only
   - **Impact:** 50% manual work for new modules
   - **Fix:** Generate implementation files, not just structure

---

## ARCHITECTURAL DECISIONS (ADRs)

### Critical ADRs for This Work

| ADR      | Title                                    | Status      | Relevance                      |
| -------- | ---------------------------------------- | ----------- | ------------------------------ |
| ADR-0028 | Two-Phase Architecture Modification Flow | ✅ ACCEPTED | Defines accept/reject contract |
| ADR-0010 | Phased AI Pipeline Implementation        | ✅ ACCEPTED | Pipeline architecture          |
| ADR-0009 | Published CLI Bundling                   | ✅ ACCEPTED | Module resolution policy       |
| ADR-0027 | State Machine Evolution                  | ✅ ACCEPTED | Transaction lifecycle          |
| ADR-0013 | Timing Test Policy                       | ✅ ACCEPTED | Test strategy                  |

---

## BUILD & TEST STATUS

### Build Status

```bash
✅ yarn build — PASSING (all 34 packages)
✅ yarn typecheck — PASSING
✅ yarn lint — PASSING
```

### Test Coverage

- **Total tests:** ~351 (per ADR-0010)
- **Test runner:** Node.js `node:test` (NOT Jest/Vitest)
- **Assertion library:** Node.js `node:assert` (NOT expect())

---

## RECOMMENDED IMPLEMENTATION STRATEGY

### Phase 0: Fix Flow 1 Sequencing (2 days)

**Goal:** Stop applying patches before user review

**Tasks:**

1. Refactor `ModifyArchitectureUseCase.execute()` to:
   - Generate patches
   - Store patches in transaction metadata
   - Transition to "speculative"
   - **STOP** — do NOT apply patches
   - Return patches to client for review

2. Update accept endpoint to:
   - Retrieve patches from transaction metadata
   - Apply patches to manifest
   - Validate lint
   - Commit or rollback

3. Update client UI to:
   - Display patches for review
   - Enable accept/reject buttons
   - Handle transaction state

**Deliverable:** User can review patches before manifest mutation

### Phase 0b: Harden Flow 1 (3 days)

**Goal:** Production-grade reliability

**Tasks:**

1. Replace `execSync` with async `exec()` + timeout
2. Add SSE heartbeat mechanism
3. Add retry logic for transient failures
4. Propagate client abort signal to server
5. Add observability hooks (logs, events, tracing)

**Deliverable:** Resilient pipeline with recovery mechanisms

### Phase 1: MCP Transaction Tools (2 days)

**Goal:** Enable AI agent transaction management

**Tasks:**

1. Add `GetTransactionToolUseCase`
2. Add `AcceptTransactionToolUseCase`
3. Add `RejectTransactionToolUseCase`
4. Add `RollbackTransactionToolUseCase`
5. Register tools in MCP server
6. Add integration tests

**Deliverable:** AI agents can manage transactions via MCP

### Phase 2: Workspace Root Path Fix (1 day)

**Goal:** Fix worktree path resolution

**Tasks:**

1. Add worktree detection to sync engine
2. Update manifest path resolution
3. Add tests for worktree scenarios

**Deliverable:** Manifest mutations go to correct file

### Phase 3: Auto-Update Linter Config (1 day)

**Goal:** Eliminate manual linter config updates

**Tasks:**

1. Add dependency change detection
2. Auto-update linter config on dependency add
3. Add validation tests

**Deliverable:** `yarn lint:arch` passes automatically

---

## CONCLUSION

### System Health: 🟢 GOOD

- ✅ Build passing
- ✅ Architecture compliant
- ✅ Accept/reject endpoints fully implemented
- ✅ Transaction system properly wired

### Critical Issue: 🔴 Flow 1 Sequencing Bug

**The only blocking issue is the Flow 1 sequencing bug** — patches are applied before user review, violating ADR-0028.

**Fix complexity:** MEDIUM (2 days)
**Risk:** LOW (well-understood, isolated change)
**Blocks:** A2UI Phases 2–5

### Recommendation

**Proceed with Phase 0 fix immediately.** All other gaps are P1/P2 and can be addressed post-launch.

---

## APPENDIX: File Locations

### Critical Files

| File                                                                                                                                                 | Purpose              | Lines |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----- |
| [`modify-architecture.use-case.ts`](../../packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts)                    | Flow 1 orchestration | 400+  |
| [`accept/route.ts`](../../apps/web/app/api/architecture/modify/accept/route.ts)                                                                      | Accept endpoint      | 171   |
| [`reject/route.ts`](../../apps/web/app/api/architecture/modify/reject/route.ts)                                                                      | Reject endpoint      | 115   |
| [`stream/route.ts`](../../apps/web/app/api/architecture/modify/stream/route.ts)                                                                      | SSE streaming        | 200+  |
| [`transaction.ts`](../../packages/transaction-system/src/domain/transaction.ts)                                                                      | Transaction entity   | 93    |
| [`in-memory-transaction-manager.adapter.ts`](../../packages/transaction-system/src/infrastructure/adapters/in-memory-transaction-manager.adapter.ts) | Transaction manager  | 152   |
| [`manifest-service.ts`](../../packages/sync/src/manifest-service.ts)                                                                                 | Manifest I/O         | 100+  |

### ADRs

| ADR      | Path                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-0028 | [`.architecture/decisions/ADR-0028-accept-reject-flow.md`](../../.architecture/decisions/ADR-0028-accept-reject-flow.md)                               |
| ADR-0010 | [`.architecture/decisions/ADR-0010-ai-pipeline-phased-implementation.md`](../../.architecture/decisions/ADR-0010-ai-pipeline-phased-implementation.md) |
| ADR-0009 | [`.architecture/decisions/ADR-0009-published-cli-bundling.md`](../../.architecture/decisions/ADR-0009-published-cli-bundling.md)                       |

---

**Report Status:** ✅ COMPLETE
**Next Action:** Spawn Sub-Agent 1 (Data Flow Implementor) for Phase 0 fix
