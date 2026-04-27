# Phased Flow 3 Fix Strategy — Unblock A2UI

**Date:** 2026-04-27
**Context:** [Data Flow Cartography](DATA-FLOW-CARTOGRAPHY-2026-04-27.md) revealed Flow 3 (accept/reject) is broken
**Goal:** Unblock A2UI development with minimum viable fix, then harden Flow 1 post-launch

---

## Strategy Overview

### Phase 0: Minimum Viable Fix (Days 1–2)

**Goal:** Repair accept/reject endpoints to enable user review loop
**Deliverable:** A2UI can work with pre-review + approval workflow
**Unblocks:** A2UI Phases 1–2

### Phase 0b: Flow 1 Hardening (Days 3–5)

**Goal:** Production-grade reliability for Flow 1
**Deliverable:** Resilient pipeline with recovery mechanisms
**Timeline:** After A2UI Phase 1 ships

---

## Phase 0: Minimum Viable Fix (2 Days)

### Scope

1. Implement accept endpoint properly
2. Implement reject endpoint properly
3. Redesign Flow 1 to stop before mutation
4. Add client-side accept/reject UI
5. Integration tests

### Success Criteria

- ✅ User can preview patches before manifest mutation
- ✅ Accept button applies patches + commits transaction
- ✅ Reject button discards patches + rolls back transaction
- ✅ Manifest only mutates after user approval
- ✅ Git restore works on rejection

---

## Task 1: Implement Accept Endpoint (4 hours)

### File: `apps/web/app/api/architecture/modify/accept/route.ts`

**Current State (Broken):**

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, patches } = body;

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    const logger = getLogger();
    logger.info("[api/architecture/modify/accept] Accepting patches", {
      transactionId,
      patchCount: Array.isArray(patches) ? patches.length : 0,
    });

    return NextResponse.json({
      success: true,
      transactionId,
      status: "accepted",
    });
  } catch (error) {
    const logger = getLogger();
    logger.errorWithException(error, "[api/architecture/modify/accept] Failed");
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
```

**Target State (Fixed):**

```typescript
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getLogger } from "@/lib/wire";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
} from "@/lib/wire.server";
import type { Patch } from "@hexagen/reconciliation-engine";

export async function POST(request: NextRequest) {
  const logger = getLogger();

  try {
    const body = await request.json();
    const { transactionId, patches, manifestPath } = body as {
      transactionId: string;
      patches: Patch[];
      manifestPath?: string;
    };

    // Validate required fields
    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    if (!patches || !Array.isArray(patches) || patches.length === 0) {
      return NextResponse.json(
        { success: false, error: "patches array is required" },
        { status: 400 },
      );
    }

    // Get dependencies
    const transactionManager = getTransactionManager();
    const manifestMutation = getManifestMutation();
    const lintValidation = getLintValidation();

    // Validate transaction exists and is in correct state
    const transaction = transactionManager.get(transactionId);
    if (!transaction) {
      return NextResponse.json(
        { success: false, error: `Transaction ${transactionId} not found` },
        { status: 404 },
      );
    }

    if (transaction.status !== "speculative") {
      return NextResponse.json(
        {
          success: false,
          error: `Transaction is ${transaction.status}, expected speculative`,
        },
        { status: 400 },
      );
    }

    logger.info("[api/architecture/modify/accept] Applying patches", {
      transactionId,
      patchCount: patches.length,
    });

    // Apply patches to manifest (moved from Flow 1)
    const resolvedManifestPath =
      manifestPath ?? path.join(process.cwd(), ".architecture/manifest.yaml");

    const applyResult = await manifestMutation.applyPatches(
      patches,
      resolvedManifestPath,
    );

    if (!applyResult.success) {
      logger.error(
        "[api/architecture/modify/accept] Patch application failed",
        {
          error: applyResult.error.message,
        },
      );

      // Rollback transaction
      transactionManager.rollback(
        transactionId,
        `Patch application failed: ${applyResult.error.message}`,
      );

      return NextResponse.json(
        {
          success: false,
          error: `Failed to apply patches: ${applyResult.error.message}`,
        },
        { status: 500 },
      );
    }

    // Lint validation
    const lintResult =
      await lintValidation.validateManifest(resolvedManifestPath);
    const lintPassed = lintResult.success && lintResult.value.valid;

    if (!lintPassed) {
      const lintErrors = lintResult.success
        ? lintResult.value.errors
        : [lintResult.error.message];

      logger.warn("[api/architecture/modify/accept] Lint validation failed", {
        errors: lintErrors,
      });

      // Restore manifest from git
      const restoreResult =
        await manifestMutation.restoreFromGit(resolvedManifestPath);

      if (!restoreResult.success) {
        // CRITICAL: Lint failed + restore failed
        logger.error(
          "[api/architecture/modify/accept] CRITICAL: Restore failed after lint failure",
          {
            lintErrors,
            restoreError: restoreResult.error.message,
          },
        );

        transactionManager.rollback(
          transactionId,
          `Lint failed and restore failed: ${restoreResult.error.message}`,
        );

        return NextResponse.json(
          {
            success: false,
            error:
              "Manifest corruption detected: lint failed and restore failed",
            lintErrors,
            restoreError: restoreResult.error.message,
          },
          { status: 500 },
        );
      }

      // Restore succeeded, rollback transaction
      transactionManager.rollback(transactionId, "Lint validation failed");

      return NextResponse.json(
        {
          success: false,
          error: "Lint validation failed",
          lintErrors,
        },
        { status: 400 },
      );
    }

    // Commit transaction
    const committedTx = transactionManager.commit(transactionId);
    if (!committedTx) {
      logger.error(
        "[api/architecture/modify/accept] Failed to commit transaction",
      );

      return NextResponse.json(
        {
          success: false,
          error: `Failed to commit transaction ${transactionId}`,
        },
        { status: 500 },
      );
    }

    logger.info(
      "[api/architecture/modify/accept] Patches accepted successfully",
      {
        transactionId,
        status: committedTx.status,
      },
    );

    return NextResponse.json({
      success: true,
      transactionId,
      status: committedTx.status,
      patchesApplied: patches.length,
      lintPassed: true,
    });
  } catch (error) {
    logger.errorWithException(
      error,
      "[api/architecture/modify/accept] Unexpected error",
    );
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
```

**Dependencies to Wire:**

```typescript
// apps/web/app/lib/wire.server.ts

// Add these exports
export const getTransactionManager = () => {
  return new InMemoryTransactionManager();
};

export const getManifestMutation = () => {
  return new SyncDelegatingManifestMutationAdapter(process.cwd());
};

export const getLintValidation = () => {
  return new InMemoryLintValidationAdapter();
};
```

---

## Task 2: Implement Reject Endpoint (2 hours)

### File: `apps/web/app/api/architecture/modify/reject/route.ts`

**Current State (Broken):**

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionId, patches, reason } = body;

    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    const logger = getLogger();
    logger.info("[api/architecture/modify/reject] Rejecting patches", {
      transactionId,
      patchCount: Array.isArray(patches) ? patches.length : 0,
      reason: reason ?? "User rejected the changes",
    });

    return NextResponse.json({
      success: true,
      transactionId,
      status: "rejected",
      reason: reason ?? "User rejected the changes",
    });
  } catch (error) {
    const logger = getLogger();
    logger.errorWithException(error, "[api/architecture/modify/reject] Failed");
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
```

**Target State (Fixed):**

```typescript
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getLogger } from "@/lib/wire";
import { getTransactionManager, getManifestMutation } from "@/lib/wire.server";

export async function POST(request: NextRequest) {
  const logger = getLogger();

  try {
    const body = await request.json();
    const { transactionId, reason, manifestPath } = body as {
      transactionId: string;
      reason?: string;
      manifestPath?: string;
    };

    // Validate required fields
    if (!transactionId) {
      return NextResponse.json(
        { success: false, error: "transactionId is required" },
        { status: 400 },
      );
    }

    // Get dependencies
    const transactionManager = getTransactionManager();
    const manifestMutation = getManifestMutation();

    // Validate transaction exists and is in correct state
    const transaction = transactionManager.get(transactionId);
    if (!transaction) {
      return NextResponse.json(
        { success: false, error: `Transaction ${transactionId} not found` },
        { status: 404 },
      );
    }

    if (transaction.status !== "speculative") {
      return NextResponse.json(
        {
          success: false,
          error: `Transaction is ${transaction.status}, expected speculative`,
        },
        { status: 400 },
      );
    }

    const rejectionReason = reason ?? "User rejected the changes";

    logger.info("[api/architecture/modify/reject] Rejecting patches", {
      transactionId,
      reason: rejectionReason,
    });

    // Rollback transaction
    const rolledBackTx = transactionManager.rollback(
      transactionId,
      rejectionReason,
    );
    if (!rolledBackTx) {
      logger.error(
        "[api/architecture/modify/reject] Failed to rollback transaction",
      );

      return NextResponse.json(
        {
          success: false,
          error: `Failed to rollback transaction ${transactionId}`,
        },
        { status: 500 },
      );
    }

    // Note: No manifest restore needed because patches were never applied
    // (Flow 1 now stops before mutation)

    logger.info(
      "[api/architecture/modify/reject] Patches rejected successfully",
      {
        transactionId,
        status: rolledBackTx.status,
      },
    );

    return NextResponse.json({
      success: true,
      transactionId,
      status: rolledBackTx.status,
      reason: rejectionReason,
    });
  } catch (error) {
    logger.errorWithException(
      error,
      "[api/architecture/modify/reject] Unexpected error",
    );
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
```

---

## Task 3: Redesign Flow 1 to Stop Before Mutation (3 hours)

### File: `packages/agentic-interaction/src/application/use-cases/modify-architecture.use-case.ts`

**Changes Required:**

1. **Remove patch application from `commitPatches()` method:**

```typescript
// OLD (lines 293-343)
private async commitPatches(
  patches: Patch[],
  lineage: IntentLineage,
  manifestPath: string,
): Promise<Result<Transaction, Error>> {
  const transaction = this.deps.transactionManager.begin(lineage.intentId, {
    intentId: lineage.intentId,
    origin: lineage.origin,
  });
  this.deps.transactionManager.transition(transaction.id, "speculative");

  const applyResult = await this.deps.manifestMutation.applyPatches(
    patches,
    manifestPath,
  );
  // ... rest of method
}

// NEW
private async beginTransaction(
  patches: Patch[],
  lineage: IntentLineage,
): Promise<Result<Transaction, Error>> {
  const transaction = this.deps.transactionManager.begin(lineage.intentId, {
    intentId: lineage.intentId,
    origin: lineage.origin,
    patches, // Store patches in metadata for later
  });
  this.deps.transactionManager.transition(transaction.id, "speculative");

  return { success: true, value: transaction };
}
```

2. **Update `execute()` method to stop after reconciliation:**

```typescript
// OLD (lines 105-118)
run = this.advanceStep(run, STEP_COMMIT, startStep);
const commitResult = await this.commitPatches(patches, lineage, manifestPath);
if (!commitResult.success) {
  run = this.advanceStep(run, STEP_COMMIT, (s) =>
    failStep(s, commitResult.error.message),
  );
  run = failRun(run);
  return { success: false, error: commitResult.error };
}

const lintResult =
  await this.deps.lintValidation.validateManifest(manifestPath);
// ... lint validation logic

// NEW
run = this.advanceStep(run, STEP_COMMIT, startStep);
const txResult = await this.beginTransaction(patches, lineage);
if (!txResult.success) {
  run = this.advanceStep(run, STEP_COMMIT, (s) =>
    failStep(s, txResult.error.message),
  );
  run = failRun(run);
  return { success: false, error: txResult.error };
}

// STOP HERE — no patch application, no lint validation
run = this.advanceStep(run, STEP_COMMIT, completeStep);
run = completeRun(run);

return {
  success: true,
  value: {
    pipelineRunId: run.id,
    patchesApplied: 0, // Not applied yet
    lintPassed: null, // Not validated yet
    transactionId: txResult.value.id,
    steps: run.steps,
    patches,
  },
};
```

4. **Update SSE route to handle `lintPassed: null`:**

```typescript
// apps/web/app/api/architecture/modify/stream/route.ts:143-149

// OLD
if (result.success) {
  send("pipeline_complete", {
    pipelineRunId: result.value.pipelineRunId,
    patchesApplied: result.value.patchesApplied,
    lintPassed: result.value.lintPassed,
    transactionId: result.value.transactionId,
    patches: result.value.patches ?? [],
  });
}

// NEW
if (result.success) {
  send("pipeline_complete", {
    pipelineRunId: result.value.pipelineRunId,
    patchesApplied: result.value.patchesApplied,
    lintPassed: result.value.lintPassed, // Can be null now
    transactionId: result.value.transactionId,
    patches: result.value.patches ?? [],
  });
}
```

3. **Update return type to reflect pending state:**

```typescript
// packages/agentic-interaction/src/application/ports/in/architecture-modification.port.ts

export interface ModificationResult {
  pipelineRunId: string;
  patchesApplied: number;
  lintPassed: boolean | null; // NEW: null = not validated yet
  transactionId: string;
  steps: PipelineStep[];
  patches: Patch[];
}
```

---

## Task 4: Client-Side Accept/Reject UI (4 hours)

### Component Contract

**File:** `apps/web/features/governance-assistant/architecture-modification/PatchReviewPanel.tsx`

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { Patch } from "@hexagen/reconciliation-engine";
import type { ArchitectureModificationResult } from "../hooks/useArchitectureModification";

interface PatchReviewPanelProps {
  result: ArchitectureModificationResult;
  onAccept: () => Promise<void>;
  onReject: (reason?: string) => Promise<void>;
}

export function PatchReviewPanel({ result, onAccept, onReject }: PatchReviewPanelProps) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept patches");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleReject = async () => {
    setIsRejecting(true);
    setError(null);
    try {
      await onReject("User rejected the changes");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject patches");
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <Card className="border-warning/30 bg-warning/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Review Required
        </CardTitle>
        <CardDescription>
          {result.patches.length} patch{result.patches.length !== 1 ? "es" : ""} generated.
          Review and approve to apply changes to the manifest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {result.patches.map((patch, idx) => (
            <div key={idx} className="text-sm p-2 bg-white rounded border">
              <span className="font-medium">{patch.type}</span>: {patch.targetId}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleAccept}
            disabled={isAccepting || isRejecting}
            className="flex-1"
          >
            {isAccepting ? (
              "Applying..."
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Accept & Apply
              </>
            )}
          </Button>
          <Button
            onClick={handleReject}
            disabled={isAccepting || isRejecting}
            variant="outline"
            className="flex-1"
          >
            {isRejecting ? (
              "Rejecting..."
            ) : (
              <>
                <XCircle className="mr-2 h-4 w-4" />
                Reject
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Hook Updates

**File:** `apps/web/features/governance-assistant/hooks/useArchitectureModification.ts`

```typescript
// Add new methods to the hook

const acceptPatches = useCallback(async () => {
  if (!state.result) return;

  try {
    const response = await fetch("/api/architecture/modify/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: state.result.transactionId,
        patches: state.result.patches,
      }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    // Update state to reflect acceptance
    setState((prev) => ({
      ...prev,
      result: prev.result
        ? {
            ...prev.result,
            patchesApplied: data.patchesApplied,
            lintPassed: data.lintPassed,
          }
        : null,
    }));

    return data;
  } catch (error) {
    throw error;
  }
}, [state.result]);

const rejectPatches = useCallback(
  async (reason?: string) => {
    if (!state.result) return;

    try {
      const response = await fetch("/api/architecture/modify/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: state.result.transactionId,
          reason: reason ?? "User rejected",
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error);
      }

      // Reset state after rejection
      reset();

      return data;
    } catch (error) {
      throw error;
    }
  },
  [state.result, reset],
);

return {
  ...state,
  modify,
  abort,
  reset,
  acceptPatch, // Keep for individual patch acceptance (future)
  rejectPatch, // Keep for individual patch rejection (future)
  acceptPatches, // NEW: Accept all patches
  rejectPatches, // NEW: Reject all patches
};
```

---

## Task 5: Integration Tests (3 hours)

### Test File: `apps/web/__tests__/api/architecture/modify/accept-reject-flow.test.ts`

```typescript
import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { POST as acceptPOST } from "@/app/api/architecture/modify/accept/route";
import { POST as rejectPOST } from "@/app/api/architecture/modify/reject/route";
import {
  getTransactionManager,
  clearModifyArchitectureCache,
} from "@/lib/wire.server";
import type { Patch } from "@hexagen/reconciliation-engine";

describe("Accept/Reject Flow", () => {
  beforeEach(() => {
    clearModifyArchitectureCache();
  });

  afterEach(() => {
    clearModifyArchitectureCache();
  });

  it("should accept patches and apply to manifest", async () => {
    // Setup: Create a speculative transaction
    const transactionManager = getTransactionManager();
    const tx = transactionManager.begin("test-intent", {});
    transactionManager.transition(tx.id, "speculative");

    const patches: Patch[] = [
      {
        id: "patch-1",
        type: "add_node",
        targetId: "test-context",
        payload: { name: "test-context", type: "core" },
      },
    ];

    // Execute: Accept patches
    const request = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: tx.id,
          patches,
        }),
      },
    );

    const response = await acceptPOST(request as any);
    const data = await response.json();

    // Assert
    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.patchesApplied, 1);
    assert.strictEqual(data.lintPassed, true);

    // Verify transaction state
    const updatedTx = transactionManager.get(tx.id);
    assert.strictEqual(updatedTx?.status, "committed");
  });

  it("should reject patches and rollback transaction", async () => {
    // Setup: Create a speculative transaction
    const transactionManager = getTransactionManager();
    const tx = transactionManager.begin("test-intent", {});
    transactionManager.transition(tx.id, "speculative");

    // Execute: Reject patches
    const request = new Request(
      "http://localhost:3000/api/architecture/modify/reject",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: tx.id,
          reason: "Test rejection",
        }),
      },
    );

    const response = await rejectPOST(request as any);
    const data = await response.json();

    // Assert
    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.reason, "Test rejection");

    // Verify transaction state
    const updatedTx = transactionManager.get(tx.id);
    assert.strictEqual(updatedTx?.status, "rolled_back");
  });

  it("should fail to accept non-existent transaction", async () => {
    const request = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: "non-existent",
          patches: [],
        }),
      },
    );

    const response = await acceptPOST(request as any);
    const data = await response.json();

    assert.strictEqual(response.status, 404);
    assert.strictEqual(data.success, false);
    assert.match(data.error, /not found/);
  });

  it("should fail to accept transaction in wrong state", async () => {
    // Setup: Create a committed transaction
    const transactionManager = getTransactionManager();
    const tx = transactionManager.begin("test-intent", {});
    transactionManager.transition(tx.id, "speculative");
    transactionManager.commit(tx.id);

    const request = new Request(
      "http://localhost:3000/api/architecture/modify/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: tx.id,
          patches: [],
        }),
      },
    );

    const response = await acceptPOST(request as any);
    const data = await response.json();

    assert.strictEqual(response.status, 400);
    assert.strictEqual(data.success, false);
    assert.match(data.error, /expected speculative/);
  });
});
```

---

## Phase 0 Timeline

| Day       | Task                              | Hours   | Owner          |
| --------- | --------------------------------- | ------- | -------------- |
| **Day 1** | Task 1: Implement accept endpoint | 4h      | Backend dev    |
|           | Task 2: Implement reject endpoint | 2h      | Backend dev    |
|           | Task 3: Redesign Flow 1           | 3h      | Backend dev    |
| **Day 2** | Task 4: Client-side UI            | 4h      | Frontend dev   |
|           | Task 5: Integration tests         | 3h      | QA/Backend dev |
|           | **Total**                         | **16h** | **2 days**     |

---

## Phase 0b: Flow 1 Hardening (Days 3–5)

### Scope

1. Replace `execSync` with async `exec` + timeout
2. Add SSE heartbeat + client abort detection
3. Implement Git restore recovery (snapshot + retry)
4. Add retry logic for transient failures
5. Production testing

### Timeline: After A2UI Phase 1 ships

---

## A2UI Integration Points

### Phase 1: Foundation (Unblocked by Phase 0)

- ✅ Intent parser can use repaired Flow 3
- ✅ SSE streaming works as-is
- ✅ Validation layer can check transaction state

### Phase 2: Wizard (Unblocked by Phase 0)

- ✅ Auto-fill generates patches → user reviews → accepts/rejects
- ✅ Validation explainer shows lint errors before acceptance
- ⚠️ **Blocked by Flow 1 RISK:** Blocking `execSync` in lint validation

### Phase 3: Canvas (Unblocked by Phase 0)

- ✅ Node manipulation generates patches → user reviews → accepts/rejects
- ✅ Undo mechanism uses reject endpoint

### Phase 4: Editor (Blocked by Flow 1 RISK)

- ❌ **Blocked:** Inline suggestions need non-blocking lint validation
- ❌ **Blocked:** Real-time feedback requires SSE heartbeat

### Phase 5: Polish (Partially Blocked)

- ✅ Undo/redo uses accept/reject endpoints
- ⚠️ **Blocked by Flow 1 RISK:** Command history needs reliable pipeline

---

## Flow 1 RISKs That Block A2UI

| Risk                    | Blocks                           | Phase 0b Task                       |
| ----------------------- | -------------------------------- | ----------------------------------- |
| **Blocking `execSync`** | Phase 2 (lint), Phase 4 (inline) | Replace with async `exec` + timeout |
| **No SSE heartbeat**    | Phase 4 (real-time feedback)     | Add heartbeat mechanism             |
| **No retry logic**      | Phase 5 (reliability)            | Add exponential backoff             |
| **Git restore failure** | All phases (data loss)           | Implement snapshot + retry          |
| **No abort detection**  | Phase 4 (responsiveness)         | Add client abort handling           |

---

## Success Metrics

### Phase 0 (MVP)

- ✅ Accept endpoint applies patches correctly (100% test coverage)
- ✅ Reject endpoint rolls back correctly (100% test coverage)
- ✅ Flow 1 stops before mutation (verified by integration tests)
- ✅ Client UI shows accept/reject buttons (manual QA)
- ✅ End-to-end flow works: modify → preview → accept → manifest mutates

### Phase 0b (Hardening)

- ✅ Lint validation completes in <5s (95th percentile)
- ✅ SSE heartbeat detects broken connections within 10s
- ✅ Git restore succeeds 99.9% of the time
- ✅ Transient failures retry successfully (3 attempts)
- ✅ Client abort stops server execution within 5s

---

## Rollout Plan

### Week 1: Phase 0 (Days 1–2)

- Day 1: Implement accept/reject endpoints + redesign Flow 1
- Day 2: Client UI + integration tests
- **Gate:** All tests pass, manual QA confirms accept/reject works

### Week 2: A2UI Phase 1 (Days 3–7)

- Build A2UI foundation on top of repaired Flow 3
- **Gate:** A2UI Phase 1 ships to staging

### Week 3: Phase 0b (Days 8–12)

- Harden Flow 1 for production
- **Gate:** All Flow 1 RISKs mitigated, production metrics met

### Week 4: A2UI Phase 2–3 (Days 13–17)

- Wizard + Canvas integration
- **Gate:** A2UI Phase 2–3 ships to production

---

## Pre-Deployment Checklist

**Before deploying Phase 0:**

1. ✅ Ensure no in-flight transactions exist in production
2. ✅ If any speculative transactions exist, manually restore manifests
3. ✅ Run `yarn build && yarn typecheck && yarn lint` — all must pass
4. ✅ Run integration tests — 100% pass rate required
5. ✅ Verify path validation works (test with `../../etc/passwd`)
6. ✅ Verify singleton caching works (test transaction lookup)
7. ✅ Verify defensive restore in reject endpoint (test with pre-mutated manifest)

---

## Risk Mitigation

### Risk: Phase 0 takes longer than 2 days

**Mitigation:** Timebox to 2 days, defer non-critical features (e.g., individual patch accept/reject) to Phase 0b

### Risk: Flow 1 hardening blocks A2UI Phase 4

**Mitigation:** Implement async `exec` + timeout first (Day 3), defer other hardening to post-launch

### Risk: Integration tests reveal edge cases

**Mitigation:** Add edge case handling to accept/reject endpoints, extend timeline by 1 day if needed

---

## Next Steps

1. **Approve this plan** → Proceed to implementation
2. **Delegate tasks:**
   - `delegate fix-flow-3-endpoints` → Backend dev (Tasks 1–3)
   - `develop a2ui-phase-1` → Frontend dev (Task 4)
   - `delegate flow-1-hardening` → Backend dev (Phase 0b, post-launch)

---

**END OF STRATEGY**
