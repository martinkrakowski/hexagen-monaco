# PHASE 0 BLOCKERS — CONSOLIDATED IMPLEMENTATION DELEGATION

**Branch:** `fix/phase-0-blockers-consolidated`  
**Duration:** 3 days (22 hours)  
**Start Date:** 2026-04-27  
**Scope:** 6 PHASED-FLOW3 critical fixes + 3 architectural consistency fixes + 2 security hardening fixes

---

## EXECUTIVE SUMMARY

This branch consolidates all Phase 0 blocking issues identified in:

- `PHASED-FLOW3-FIX-CRITICAL-UPDATES-2026-04-27.md` (6 issues)
- Architectural review findings (3 consistency fixes)
- Security audit findings (2 package isolation fixes)

**Deliverable:** End-to-end Phase 0 implementation — accept/reject flow with manifest mutations, reversible state, and unified UI.

---

## TASK DELEGATION

### TASK 1: Wire Dependencies (Backend Lead) — Day 1, 2h

**Owner:** Backend developer  
**Location:** `apps/web/app/lib/wire.server.ts`  
**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issue 1

**Subtasks:**

1. Implement singleton caching for `TransactionManager`, `ManifestMutation`, `LintValidation` adapters
2. Create getters: `getTransactionManager()`, `getManifestMutation()`, `getLintValidation()`
3. Update `clearModifyArchitectureCache()` to reset all three singletons
4. Add test ensuring same instance returned across multiple calls

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint
# Singleton tests pass: transaction lookup succeeds across requests
```

**Exact Code:** See `PHASED-FLOW3-FIX-CRITICAL-UPDATES.md` lines 21-61

---

### TASK 2: Accept Endpoint (Backend Lead) — Day 1, 5h

**Owner:** Backend developer  
**Location:** `apps/web/app/api/architecture/modify/accept/route.ts`  
**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issues 1-2

**Subtasks:**

1. Add `validateManifestPath(rawPath: string): string` function
   - Prevents `../../etc/passwd` directory traversal
   - Throws if path outside `.architecture/` directory
2. Implement POST accept endpoint:
   - Validate transactionId exists
   - Validate manifestPath (if provided)
   - Transition transaction to `speculative` → `pending` → `committed`
   - Restore manifest from git on acceptance
   - Return 200 with transaction state
3. Handle error cases: 400 (missing ID), 404 (not found), 409 (wrong state), 500 (restore fails)

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint
# Accept tests:
# ✅ Returns 400 if transactionId missing
# ✅ Returns 404 if transaction not found
# ✅ Returns 409 if not in speculative state
# ✅ Returns 400 if path traversal attempted (../../etc/passwd)
# ✅ Accepts valid patch, commits, restores manifest
```

**Exact Code:** See `PHASED-FLOW3-FIX-CRITICAL-UPDATES.md` lines 72-116

---

### TASK 3 SUBTASK: Move LocalLLMProvider (Backend Lead) — Day 1, 45min

**Owner:** Backend developer  
**Location:** `apps/web/app/providers/LocalLLMProvider.tsx` (NEW)  
**Reference:** Architectural fix #1

**Subtasks:**

1. Create `apps/web/app/providers/LocalLLMProvider.tsx`:
   - Re-export `LocalLLMProvider` from `@../features/llm-driver/useLocalLlm`
   - Do NOT move the provider itself — keep logic in feature
2. Update `apps/web/app/layout.tsx`:
   - Change import from `@/llm-driver/useLocalLlm` to `@/app/providers/LocalLLMProvider`
   - Ensure provider wraps correctly in layout hierarchy

**Success Criteria:**

```bash
yarn build && yarn typecheck
# Verify: layout.tsx imports from app/providers, not features
```

---

### TASK 4: Reject Endpoint (Backend Lead) — Day 2, 3h

**Owner:** Backend developer  
**Location:** `apps/web/app/api/architecture/modify/reject/route.ts`  
**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issues 2-3

**Subtasks:**

1. Add `validateManifestPath()` function (reuse from accept endpoint)
2. Implement POST reject endpoint:
   - Validate transactionId exists
   - Rollback transaction
   - Defensive manifest restore from git (may have been mutated by inflight transactions)
   - Return 200 with rolled-back transaction state
3. Handle errors: 404 (not found), 500 (rollback fails), 400 (invalid path)
4. Log non-critical restore failures (transaction already rolled back)

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint
# Reject tests:
# ✅ Returns 404 if transaction not found
# ✅ Rolls back transaction correctly
# ✅ Restores manifest defensively
# ✅ Handles path traversal attempts
```

**Exact Code:** See `PHASED-FLOW3-FIX-CRITICAL-UPDATES.md` lines 121-187

---

### TASK 5: Flow 1 Redesign (Backend Lead) — Day 2, 4h

**Owner:** Backend developer  
**Location:**

- `apps/web/app/api/architecture/modify/route.ts` (Flow 0a producer)
- `packages/agentic-interaction/src/application/ports/in/architecture-modification.port.ts` (interface)
- `apps/web/app/api/architecture/modify/stream/route.ts` (SSE)

**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issues 3-4

**Subtasks:**

1. **Split Flow 0 into two flows:**
   - **Flow 0a:** Stop after reconciliation (before mutation) — returns `lintPassed: null`
   - **Flow 0b:** Apply patches and commit (separate, explicit action)

2. **Update Phase endpoint (`/api/architecture/modify`):**
   - Return `patchesApplied: 0, lintPassed: null, transactionId: <NEW>`
   - Create speculative transaction
   - Do NOT apply patches yet
   - Emit SSE: `phase_complete` with pending verdict

3. **Update SSE route (`/api/architecture/modify/stream`):**
   - Handle `lintPassed: null` in response
   - Verify client can parse and display "pending" state

4. **Update ModificationResult interface:**

   ```typescript
   export interface ModificationResult {
     pipelineRunId: string;
     patchesApplied: number;
     lintPassed: boolean | null; // ← NEW: null = not validated yet
     transactionId: string;
     steps: PipelineStep[];
     patches: Patch[];
   }
   ```

5. **Test Flow 0a:**
   - Modify → Phase → SSE emits `lintPassed: null`
   - Manifest unchanged (no patches applied)
   - Next: user calls Accept (Task 2) or Reject (Task 4)

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint
# Flow 0a tests:
# ✅ Returns patchesApplied: 0, lintPassed: null
# ✅ Creates speculative transaction
# ✅ Manifest does not change after modify
# ✅ Accept endpoint can find and commit transaction
# ✅ Reject endpoint can find and rollback transaction
```

---

### TASK 6 SUBTASK: llm-driver Barrel (Backend Lead) — Day 2, 15min

**Owner:** Backend developer  
**Location:** `apps/web/features/llm-driver/index.ts` (NEW)  
**Reference:** Architectural fix #2

**Subtasks:**

1. Create barrel export file:
   ```typescript
   export { LocalLLMProvider, useLocalLLM } from "./useLocalLlm.js";
   export { AUTO_LOAD_KEY, HAS_ENABLED_KEY } from "./local-llm/storage-keys.js";
   export type { ChatMessage } from "./useLocalLlm.js";
   ```
2. Consumers can now import from `@/llm-driver` instead of `@/llm-driver/useLocalLlm`

**Success Criteria:**

```bash
yarn build && yarn typecheck
# Verify: llm-driver/index.ts exports all needed symbols
```

---

### TASK 7 SUBTASK: ExportContext Fix (Backend Lead) — Day 2, 30min

**Owner:** Backend developer  
**Location:**

- `apps/web/app/contexts/ExportContext.tsx`
- `packages/deployment/src/domain/export.types.ts` (NEW or existing)

**Reference:** Architectural fix #3

**Subtasks:**

1. Move `ExportDialogSubmitPayload` type to `@hexagen/deployment`:
   ```typescript
   // packages/deployment/src/domain/export.types.ts
   export interface ExportDialogSubmitPayload {
     repoName: string;
     isPrivate: boolean;
   }
   ```
2. Update `ExportContext` import:
   ```typescript
   import type { ExportDialogSubmitPayload } from "@hexagen/deployment";
   ```
3. Verify no circular dependencies

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint:arch
# ExportContext imports from package, not feature
```

---

### TASK 8: Client UI (Frontend Lead) — Day 3, 4h

**Owner:** Frontend developer  
**Location:** `apps/web/features/governance-assistant/architecture-modification/`  
**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issue 5

**Subtasks:**

1. Build `ArchitectureModificationPanel` wrapper:
   - Display accept/reject buttons (disabled until `lintPassed` verdict ready)
   - Show SSE stream status: "Modifying...", "Receiving patches...", "Ready for review"

2. Implement `PatchReviewPanel`:
   - Display suggested patches with diffs
   - Show "Review Required" warning card using `--warning` design token (NOT `amber-*`)
   - Accept/Reject buttons call respective endpoints

3. Implement `VerdictCard`:
   - Green: "Accepted — Manifest updated"
   - Red: "Rejected — Manifest unchanged"
   - Transient 3s display, then reset

4. Handle streaming states:
   - Optimize updates to avoid re-renders
   - Cancel SSE connection on unmount or explicit close

5. SSE integration:
   - Subscribe to `/api/architecture/modify/stream?pipelineRunId=<ID>`
   - Parse events: `phase_complete`, `pipeline_step`, `pipeline_complete`
   - Handle `lintPassed: null` gracefully (show pending indicator)

**Success Criteria:**

```bash
yarn build && yarn typecheck && yarn lint
# UI Tests:
# ✅ Buttons disabled until verdict ready
# ✅ PatchReviewPanel shows design tokens, not arbitrary colors
# ✅ SSE streaming works and updates UI
# ✅ Accept/Reject buttons trigger endpoints
# ✅ VerdictCard displays correctly
```

---

### TASK 9: Integration Tests (QA/Backend Lead) — Day 3, 4h

**Owner:** QA or Backend developer  
**Location:** `apps/web/__tests__/api/architecture/modify/`  
**Reference:** PHASED-FLOW3-FIX-CRITICAL-UPDATES Issue 6

**Subtasks:**

1. **Accept endpoint tests:**
   - ✅ 400 if transactionId missing
   - ✅ 404 if transaction not found
   - ✅ 409 if not in speculative state
   - ✅ 400 if path traversal (`../../etc/passwd`)
   - ✅ 200 if valid (patches applied, manifest mutated)

2. **Reject endpoint tests:**
   - ✅ 404 if transaction not found
   - ✅ 200 if valid (transaction rolled back, manifest restored)
   - ✅ 400 if path traversal attempted

3. **Flow 0a tests:**
   - ✅ Modify → Phase → `lintPassed: null`
   - ✅ Manifest unchanged after modify
   - ✅ Transaction ID created and findable

4. **Transaction lifecycle tests:**
   - ✅ Create → Speculative → Pending → Committed (accept path)
   - ✅ Create → Speculative → Rolled Back (reject path)
   - ✅ Singleton caching: same manager across requests

5. **Manifest integrity tests:**
   - ✅ Accept applies patches correctly
   - ✅ Reject restores from git
   - ✅ Defensive restore works for inflight mutations

6. **Security tests:**
   - ✅ Path validation blocks all traversal patterns
   - ✅ No path injection via manifestPath parameter

**Success Criteria:**

```bash
yarn test
# All tests pass (100% coverage of critical paths)
yarn build && yarn typecheck && yarn lint:arch
```

---

### TASK 10: Package Safety (Backend Lead) — Day 3, 1h

**Owner:** Backend developer  
**Location:**

- `packages/local-llm/package.json` (conditional exports)
- `.eslint-settings/` or monorepo eslint config (rule)
- `.architecture/manifest.yaml` (documentation)

**Reference:** Security hardening fixes

**Subtasks:**

1. **Add conditional exports to `@hexagen/local-llm`:**

   ```json
   "exports": {
     ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
     "./adapters": null,
     "./infrastructure": null
   }
   ```

   This blocks direct imports of browser-only code.

2. **Add ESLint rule** (monorepo level):

   ```
   Rule: @hexagen/sync and @hexagen/mcp-server cannot import @hexagen/local-llm
   ```

   Prevents CLI accidentally loading browser APIs.

3. **Document in manifest:**
   Add note to `@hexagen/local-llm` entry in `.architecture/manifest.yaml`:
   ```
   note: "Browser-only package (WebGPU, IndexedDB, WebLLM).
          CLI packages (@hexagen/sync, @hexagen/mcp-server) must not import this."
   ```

**Success Criteria:**

```bash
yarn build && yarn lint:arch
# No errors; conditional exports verified in dist/package.json
```

---

## DEPENDENCY GRAPH

```
Task 1 (Wire)
  ├→ Task 2 (Accept) [depends on wire singletons]
  ├→ Task 4 (Reject) [depends on wire singletons]
  ├→ Task 5 (Flow 1) [depends on wire singletons]
  └→ Task 9 (Integration Tests) [tests all wire-based flows]

Task 5 (Flow 1 Redesign)
  └→ Task 8 (Client UI) [consumes Flow 1 SSE output]

Task 2 (Accept) + Task 4 (Reject)
  └→ Task 8 (Client UI) [buttons call these endpoints]

Task 3 (Move LocalLLMProvider)
  └→ Independent [architectural consistency only]

Task 6 (llm-driver barrel)
  └→ Independent [architectural consistency only]

Task 7 (ExportContext fix)
  └→ Independent [architectural consistency only]

Task 10 (Package Safety)
  └→ Independent [security hardening only]
```

**Critical Path:**

```
Task 1 (2h) → Task 2 (5h) → Task 5 (4h) + Task 8 (4h in parallel) → Task 9 (4h)
= ~15 hours critical path
+ Task 3,6,7 (1.5h) + Task 10 (1h) = ~17.5 hours total (fits 3-day window)
```

---

## PRE-MERGE CHECKLIST

Before submitting PR, verify:

### Build & Lint ✅

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
```

### Tests ✅

```bash
yarn test
# All tests pass, including:
# - Wire singleton tests
# - Accept/Reject endpoint tests
# - Flow 0a lifecycle tests
# - Path traversal security tests
```

### Code Review ✅

- [ ] No arbitrary Tailwind colors (use design tokens)
- [ ] No `any` types
- [ ] Path validation blocks `../../`, `../`, etc.
- [ ] Transaction state machine correct (begin → speculative → pending/committed/rolled_back)
- [ ] SSE event contract validated
- [ ] Manifest restore is defensive (logged, non-critical)
- [ ] Test mocks enforce port interfaces

### Architectural ✅

- [ ] Reverse dependency fixed (ExportContext)
- [ ] llm-driver barrel created
- [ ] LocalLLMProvider moved to app/providers
- [ ] local-llm conditional exports added
- [ ] ESLint rule preventing CLI/llm-driver imports

### Design Tokens ✅

- [ ] Verify `--warning` token exists in globals.css
- [ ] PatchReviewPanel uses token (no `amber-*`)
- [ ] Test in light and dark mode

### Manifest Integrity ✅

- [ ] Accept endpoint verifies patches apply cleanly
- [ ] Reject endpoint defensive restore works
- [ ] Manifest state after accept matches intentions

---

## READY TO IMPLEMENT

This branch is **ready for immediate development**. All tasks have:

- ✅ Clear docstrings and pseudocode
- ✅ Inline code examples from PHASED-FLOW3-FIX-CRITICAL-UPDATES
- ✅ Success criteria
- ✅ Dependency mapping

**Next:** Assign tasks to team members and begin Task 1.

---

**Last Updated:** 2026-04-27  
**Status:** READY FOR DELEGATION  
**Prepared By:** Lead Architect (OpenCode)
