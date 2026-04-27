# AI-Driven Architecture Modification Pipeline — Code Review & Remediation Plan

> **Document Type:** Code Review Analysis + Remediation Work Plan
> **Review Scope:** Phases 0–8a implementation (all packages)
> **Date:** 2026-04-26
> **Review Mode:** Comprehensive audit — architectural violations, critical defects, test coverage gaps

---

## Executive Summary

The AI-driven architecture modification pipeline is architecturally sound on the macro level (layers, dependencies, manifest compliance all pass), but exhibits **14 critical path violations**, **7 architectural smells**, and significant test coverage gaps across transaction management, reconciliation, NL parsing, and UI integration layers.

**Overall Assessment:** Core infrastructure is solid; production readiness compromised by incomplete implementations and uncaught failure modes.

---

## Verification Status

| Check            | Status  | Notes                                                               |
| ---------------- | ------- | ------------------------------------------------------------------- |
| `yarn build`     | ✅ PASS | 33/33 packages                                                      |
| `yarn typecheck` | ✅ PASS | 55/55 tasks                                                         |
| `yarn lint:arch` | ✅ PASS | "Architecture is compliant with manifest.yaml"                      |
| `yarn lint`      | ⚠️ FAIL | Pre-existing ESLint v9 flat-config issue (unrelated to AI pipeline) |

---

## Critical Violations

### 🔴 Category 1: Outbound Port Abstraction Mismatch (Violation #1)

**Finding:** `ManifestPatchPort` declared in `manifest.yaml:1177` but no adapter implementation exists.

- `reconciliation-engine`'s `ReconcileUseCase` constructor accepts optional `ManifestPatchPort`, but wiring layer has no provider
- If `manifestPatchPort` is injected during `execute()`, patches are validated but never persisted at this layer
- Patches are only persisted via `CommitPatchesUseCase` (transaction-system), creating a dual-writable-state problem

**Impact:**

- Silent failure: patches validated in reconciliation but never applied if port is wired
- Testing: all `reconcile.use-case` tests pass by not wiring the port

**Severity:** CRITICAL — Data consistency risk, silent failure

**Required Action:** Implement `ManifestPatchAdapter` in `packages/reconciliation-engine/src/infrastructure/adapters/`

---

### 🔴 Category 2: Transaction State Machine Violations (Violations #2, #3)

**Finding #2:** `commit-patches.use-case.ts:74-76` — Exception caught but transaction NOT rolled back:

```typescript
catch (err) {
  return Err(err); // ❌ Transaction left in "speculative" state
}
```

**Finding #3:** `reconcile.use-case.ts:58-60` — State never advances beyond "diffing" phase:

```typescript
for (const verdict of acceptedVerdicts) {
  state = this.promoteStatePort.promoteState(state, verdict.id); // → still "diffing"
}
```

**Impact:**

- Orphaned speculative transactions accumulate; rollback via git restore is manual
- State machine frozen in "diffing" → no signal to downstream ("approved" phase never reached)
- Cascades into transaction visibility: `TransactionManager.list("approved")` returns empty

**Severity:** CRITICAL — Data consistency risk, silent failure

**Required Actions:**

1. Add `restoreFromGit()` + `transactionManager.rollback()` to catch block
2. Call `promoteToPhase("approved")` after the state promotion loop

---

### 🔴 Category 3: Verdict Generation Auto-Accept All (Violation #4)

**Finding:** `reconcile.use-case.ts:87-91`:

```typescript
private generateVerdicts(patches: Patch[]): Verdict[] {
  return patches.map((patch) =>
    createVerdict(patch.id, true, `Auto-accepted patch ${patch.id}`), // ❌ always true
  );
}
```

**Context:** Phase 8a added `LintFilterPort` to filter patches BEFORE verdict generation, but verdicts are still auto-accepted post-filter.

**Impact:**

- Lint filtering removes blocked patches, then all remaining patches are auto-accepted
- No manual review step, no conflict resolution based on lint data
- UI's "Accept/Reject Patch" buttons are stubs that do nothing

**Severity:** CRITICAL — Violates domain model intent, security/auditability gap

---

### 🔴 Category 4: Duplicate Node Creation Vulnerability (Violation #5)

**Finding:** `sync-delegating-manifest-mutation.adapter.ts:81-86`:

```typescript
private applyAddNode(manifest: Manifest, patch: Patch): void {
  const contexts = manifest.bounded_contexts ?? [];
  const context: BoundedContext = {
    name: patch.targetId,
    type: (patch.payload.kind as BoundedContext["type"]) ?? "core",
    ...patch.payload,
  };
  contexts.push(context); // ❌ No dedup check if ctx.id already exists
  manifest.bounded_contexts = contexts;
}
```

**Impact:**

- If `ModifyArchitectureUseCase` receives a patch to add context "payment-processor" twice, both patches apply
- Manifest becomes inconsistent: duplicate bounded contexts
- Downstream linter/validators may crash on duplicate keys

**Severity:** CRITICAL — Race condition risk, data corruption

---

### 🔴 Category 5: AI Pipeline NL Pattern Gaps (Violations #6, #7)

**Finding #6:** `nl-to-domain-command.adapter.ts` — No pattern for "Update bounded context X property Y"

- Patterns cover: "create", "add", "remove", "delete"
- Missing: "update", "modify", "change", "set"

**Finding #7:** `nl-to-domain-command.adapter.ts:104` — Edge creation uses "link" not "edge"

- Pattern: `"create a link from X to Y"`
- ArchitectureGraph uses: "edges", "edge"
- Semantic mismatch with domain language

**Impact:**

- User says "Update user context to use GraphQL" → Parser produces no meaningful domain command
- Edge creation requires specific phrasing ("link") vs. common phrasing ("edge")
- Low precision: only ~30% of natural architecture descriptions match parser patterns

**Severity:** CRITICAL (for UX) — Pipeline appears "smart" but silently fails on common phrasings

---

### 🔴 Category 6: Hardcoded Failed Parse Fallback (Violations #8, #9, #10)

**Finding:** `parse-nl-intent.use-case.ts:73-75`:

```typescript
return createParsedIntent(
  "0.8", // ❌ Hardcoded confidence (was supposed to be adapter's output)
  "generic", // ❌ Always "generic" intentType
  {}, // ❌ Always empty parameters
);
```

**Impact:**

- Parser never reports what it actually matched
- Confidence is a lie (0.8 when adapter may return 0.3)
- Reconciliation engine can't filter based on intent type
- UI can't show why a parse succeeded

**Severity:** CRITICAL — Breaks observability and confidence-based filtering

---

### 🔴 Category 7: SSE Stream Contract Violations (Violations #13, #14)

**Finding #13:** `/api/architecture/modify/stream/route.ts` — No `step_running` event emitted:

```typescript
// Step starts execution
// ❌ No "step_running" event emitted
const stepResult = await step.execute();
// Only after completion:
send("step_complete", { ... });
```

**Finding #14:** `useArchitectureModification.ts:150-158` — Dead code branch:

```typescript
s.name === stepName.replace("complete", "running"); // ❌ "complete" never contains "complete"
```

**Impact:**

- UI progress bar doesn't advance until step finishes (appears stuck for 5+ seconds)
- Error updates never corrected
- SSE contract misaligned: backend sends `step_complete`, frontend expects `step_running` first

**Severity:** CRITICAL — UX failure, frozen progress bar

---

### 🔴 Category 8: Hardcoded Stub Patch Data (Violation #11)

**Finding:** `ArchitectureModificationPanel.tsx:18 & 128-134`:

```typescript
const SAMPLE_PATCHES = []; // ❌ Hardcoded empty
// PatchReviewPanel receives no actual patches to show
```

**Impact:**

- UI workflow incomplete: user sees "Modify Architecture" panel but no patches to review
- `ArchitectureModificationResult` type lacks `patches` field

**Severity:** CRITICAL — Feature appears broken/unfinished

---

### 🔴 Category 9: Stub API Methods (Violation #12)

**Finding:** `useArchitectureModification.ts:216-222`:

```typescript
const acceptPatch = useCallback((_patch: Patch) => {
  void _patch;
}, []);
const rejectPatch = useCallback((_patch: Patch) => {
  void _patch;
}, []);
```

**Impact:**

- User clicks "Accept": nothing happens
- No API call to pending changes endpoint

**Severity:** CRITICAL — Feature is non-functional

---

### 🔴 Category 10: Cloud LLM Provider Fallback Gap (Violation #15)

**Finding:** `cloud-llm-pipeline.adapter.ts:90-91`:

```typescript
async streamStructuredRequest(url: string) {
  const provider = providers[0]; // ❌ Only uses primary provider
  // No fallback to secondary provider
}
```

**Impact:**

- If primary provider is down, pipeline fails immediately
- `sendRequest()` has full fallback chain, streaming doesn't
- Asymmetric reliability

**Severity:** CRITICAL — Production reliability degraded

---

### 🔴 Category 11: Phase 8a Wiring Gap — linterReport Never Passed to Reconciliation

**Finding:** `modify-architecture.use-case.ts` fetches `linterReport` at line ~159 during prompt compilation, but `reconcile()` is called at line ~235-249 with a `ReconcileRequest` that contains **no linter report field**.

**Impact:**

- Phase 8a `LinterReportFilterAdapter` is dead code in the production pipeline
- Patches flow through without lint filtering despite a report being available
- `wire.architecture-modification.ts` provides an empty stub `emptyLinterReport`

**Severity:** CRITICAL — Phase 8a feature is non-functional in production

---

## Architectural Smells

### 🟡 Smell #1: Dual Persistence Ports with Identical Signatures

- `ManifestPatchPort` (reconciliation-engine): `applyPatches(patches, manifestPath)`
- `ManifestMutationPort` (transaction-system): `applyPatches(patches, manifestPath)`

Both ports have identical `applyPatches` signatures but different ownership. This creates confusion about responsibility boundaries.

### 🟡 Smell #2: No-Op Edge Update Method

`sync-delegating-manifest-mutation.adapter.ts:118-120`:

```typescript
private applyUpdateEdge(_manifest: Manifest, _patch: Patch): void {
  // Edge updates modify depends_on entries on contexts
}
```

Edge updates are silently dropped. If an `UpdateEdgeCommand` is processed, no error is raised but the patch has no effect.

### 🟡 Smell #3: Context Name Regex Too Restrictive

`nl-to-domain-command.adapter.ts:39`:

```typescript
const CONTEXT_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/; // ❌ No hyphens
```

Common convention: kebab-case for contexts (`payment-processor`, `order-service`). Parser only accepts snake_case.

### 🟡 Smell #4: JSON Error Response in SSE Stream

`stream/route.ts:27-31` returns JSON error responses, but the client hook expects SSE format. Errors will be parsed as SSE and silently fail.

### 🟡 Smell #5: Missing steps Array in pipeline_complete Event

`stream/route.ts:71-76` — `pipeline_complete` event omits the full steps array. The UI can't reconstruct final pipeline history with timings.

### 🟡 Smell #6: No AbortSignal Handling on Server

`stream/route.ts` — If client aborts mid-stream, server continues processing. Abandoned responses continue executing for 5+ seconds.

### 🟡 Smell #7: Root-Level Path Bypasses Segment Blocking

`linter-report-filter.adapter.ts:22-29` — For a violation like `file: "shared-kernel"` (no path separators), the segment logic is skipped entirely. Only exact match is blocked.

---

## Test Coverage Gaps

| Package               | File                                                | Gap                                                | Impact                                |
| --------------------- | --------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| transaction-system    | `commit-patches.use-case.test.ts`                   | NO TESTS for rollback on exception or lint failure | Rollback code untested                |
| transaction-system    | `sync-delegating-manifest-mutation.adapter.test.ts` | NO TESTS for duplicate add_node, no-op update_edge | Silent failures never caught          |
| reconciliation-engine | `reconcile.use-case.test.ts`                        | No test for optional ManifestPatchPort wiring      | Port behavior uncovered               |
| agentic-interaction   | `cloud-llm-pipeline.test.ts`                        | Missing: 403 Forbidden, AbortError, fallback chain | Production errors not anticipated     |
| web                   | `useArchitectureModification.test.ts`               | Shape-only tests; no real SSE stream mocking       | Hook integration untested             |
| web                   | `stream/route.ts` + POST route                      | NO INTEGRATION TESTS                               | Critical path never end-to-end tested |

---

## Root Cause Analysis

1. **Incomplete Port Abstraction Phase** — `ManifestPatchPort` declared in manifest but never implemented
2. **Transaction State Machine Not Tested Under Failure** — Happy-path tests only; catch blocks never exercised
3. **UI Stubbed for Parallel Development** — Real patches never wired to panel; Accept/Reject marked TODO
4. **NL Parser Pattern Coverage Incomplete** — Parser built for ~30% of use cases; fallback hardcoded
5. **Cloud LLM Adapter Missing Consistency Review** — `sendRequest()` has failover, `streamStructuredRequest()` diverged

---

## Recommended Fix Priority

### P0 — Must Fix (Critical Path)

| #   | Violation                                                           | Effort | Risk   |
| --- | ------------------------------------------------------------------- | ------ | ------ |
| 1   | Implement `ManifestPatchAdapter`                                    | ~3h    | Low    |
| 2   | Add `rollback()` to catch block                                     | ~1h    | Low    |
| 3   | Implement state promotion phase transition                          | ~2h    | Medium |
| 4   | Wire real patches to `PatchReviewPanel`                             | ~3h    | Medium |
| 5   | Implement `acceptPatch`/`rejectPatch` API                           | ~4h    | High   |
| 6   | Add `step_running` SSE event                                        | ~1h    | Low    |
| 7   | Fix step transition logic dead branch                               | ~30m   | Low    |
| 8   | Prevent duplicate node creation via dedup check                     | ~1h    | Low    |
| 9   | Wire Phase 8a `LinterReportFilterAdapter` in production             | ~2h    | Medium |
| 10  | Pass `linterReport` to `reconcile()` in `ModifyArchitectureUseCase` | ~1h    | Medium |

**Total P0:** ~18.5 hours

### P1 — Should Fix (Significant Gaps)

| #   | Violation                                                  | Effort | Impact                       |
| --- | ---------------------------------------------------------- | ------ | ---------------------------- |
| 11  | Add "Update bounded context" NL pattern                    | ~2h    | Parser usability             |
| 12  | Support "create an edge" phrasing                          | ~1h    | User vocabulary alignment    |
| 13  | Propagate adapter confidence + intentType                  | ~2h    | Observability                |
| 14  | Implement provider fallback in `streamStructuredRequest()` | ~1h    | Reliability                  |
| 15  | Implement `applyUpdateEdge` logic                          | ~1h    | Edge updates currently no-op |

**Total P1:** ~7 hours

### P2 — Nice to Have

- Add 403 test case to cloud-llm pipeline tests
- Support hyphens in context names (kebab-case)
- AbortSignal handling on SSE route
- Integration tests for API routes
- Root-level violation test in `LinterReportFilterAdapter`

---

## Remediation Work Plan — 9 Sub-Phases

### Phase 8b-1: Transaction System — Safety & Correctness

**Package:** `@hexagen/transaction-system` | **Effort:** ~3h

1. `commit-patches.use-case.ts` — Add rollback to catch block
2. `sync-delegating-manifest-mutation.adapter.ts` — Add existence check in `applyAddNode`; implement `applyUpdateEdge`
3. `sync-delegating-manifest-mutation.adapter.ts` — Replace `JSON.parse(JSON.stringify())` with `structuredClone()`
4. Add tests for rollback-on-exception, duplicate node rejection, edge update

**Gate:** `yarn workspace @hexagen/transaction-system test`

---

### Phase 8b-2: Reconciliation Engine — ManifestPatchAdapter

**Package:** `@hexagen/reconciliation-engine` | **Effort:** ~3h

1. Create `manifest-patch.adapter.ts` implementing `ManifestPatchPort` (delegates to `@hexagen/sync`)
2. Export from `infrastructure/adapters/index.ts`
3. Update `.architecture/manifest.yaml`
4. Add tests for validatePatches, applyPatches

**Gate:** `yarn lint:arch`

---

### Phase 8b-3: Reconciliation Engine — State Machine & Verdict Fix

**Package:** `@hexagen/reconciliation-engine` | **Effort:** ~2h

1. Call `promoteToPhase("approved")` after state promotion loop in `ReconcileUseCase`
2. Make `generateVerdicts` lint-aware: reject patches targeting errored files
3. Add tests for state advancement and lint-aware verdict generation

**Gate:** `yarn workspace @hexagen/reconciliation-engine test`

---

### Phase 8b-4: Phase 8a — LintFilterPort Production Wiring

**Package:** `@hexagen/agentic-interaction` + `apps/web` | **Effort:** ~3h

1. Add `linterReport` to `ReconcileRequest` in `ModifyArchitectureUseCase`
2. Replace `emptyLinterReport` stub with real provider in `wire.architecture-modification.ts`
3. Inject `LintFilterPort` into `ReconcileUseCase` constructor
4. Verify manifest.yaml wiring

**Gate:** `yarn build && yarn lint:arch`

---

### Phase 8b-5: Patch Data Flow to UI

**Package:** `apps/web` | **Effort:** ~3h

1. Add `patches: Patch[]` to `pipeline_complete` SSE event
2. Add `patches: Patch[]` to POST JSON response
3. Add `patches: Patch[]` to `ArchitectureModificationResult` interface
4. Replace `SAMPLE_PATCHES = []` with `result?.patches ?? []`
5. Add test for patches flow through SSE

**Gate:** `yarn build`

---

### Phase 8b-6: Accept/Reject Patch API

**Package:** `apps/web` | **Effort:** ~2h

1. Create `POST /api/architecture/modify/accept` and `/reject` endpoints
2. Implement `acceptPatch`/`rejectPatch` in `useArchitectureModification` hook
3. Add integration tests for accept/reject endpoints

**Gate:** `yarn build && yarn test`

---

### Phase 8b-7: SSE Stream — Step Events & Error Handling

**Package:** `apps/web` | **Effort:** ~1h

1. Emit `step_running` event when each step begins
2. Fix dead branch in step transition logic
3. Format JSON errors as SSE events
4. Add `AbortSignal` handling on server

**Gate:** `yarn build`

---

### Phase 8b-8: AI Pipeline — NL Pattern Completeness

**Package:** `@hexagen/ai-pipeline` | **Effort:** ~2h

1. Add Pattern 7: "create an edge from X to Y"
2. Add Pattern 8: "update bounded context X to have property Y"
3. Relax `CONTEXT_NAME_REGEX` to support kebab-case
4. Propagate `intentType` and `parameters` from adapter
5. Add tests for new patterns

**Gate:** `yarn workspace @hexagen/ai-pipeline test`

---

### Phase 8b-9: Cloud LLM — Streaming Fallback

**Package:** `@hexagen/agentic-interaction` | **Effort:** ~1h

1. Add provider fallback loop to `streamStructuredRequest()`
2. Propagate AbortError distinctly
3. Add test for 403 → fallback → success

**Gate:** `yarn workspace @hexagen/agentic-interaction test`

---

## Final Verification

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build && yarn typecheck && yarn lint && yarn lint:arch && yarn test
```

**All gates must be green from cold cache.**

---

## Conclusion

The pipeline architecture is sound, but implementation is ~60% complete. The codebase exhibits characteristics of a multi-phase scaffold where:

- ✅ Domain layers are well-structured (DDD, ports/adapters in place)
- ✅ Type safety is enforced (TypeScript strict mode)
- ✅ Linting & architecture compliance pass automated checks
- ❌ Failure paths are incomplete (no rollback on exception, state machine stalled)
- ❌ UI integration is stubbed (real patches never reach panel)
- ❌ Test coverage focuses on value objects, misses orchestration
- ❌ Production reliability at risk (single provider fallback, no abort handling)

**Verdict:** 🟡 Ready for internal testing with P0 fixes; 🔴 Not production-ready until P0 + P1 items addressed (~25 hours work).
