# Architecture Modification — Developer Guide

Guide for integrating the two-phase architecture modification flow into frontend applications.

## Overview

The architecture modification system uses a two-phase workflow:

1. **Phase 1 (Generate)**: Send a natural language intent to `/api/architecture/modify/stream`, receive real-time SSE progress events and a `transactionId`
2. **Phase 2 (Review)**: Call `/api/architecture/modify/accept` to commit patches or `/api/architecture/modify/reject` to discard them

## Transaction State Machine

```
idle → speculative → committed  (accept)
                    ↘ rolled_back  (reject)
```

| State         | Description                                     |
| ------------- | ----------------------------------------------- |
| `idle`        | No active modification request                  |
| `speculative` | Patches generated, awaiting user review         |
| `committed`   | Patches applied, lint passed, manifest updated  |
| `rolled_back` | User rejected or lint failed, manifest restored |

A transaction can only be accepted or rejected while in `speculative` state. Attempting accept/reject on any other state returns HTTP 409.

---

## Frontend Integration

### Using the `useArchitectureModification` Hook

The `@hexagen/ui` package provides `useArchitectureModification`, a React hook that handles all SSE streaming and state management:

```typescript
import { useArchitectureModification } from "@/features/governance-assistant/hooks/useArchitectureModification";

function MyComponent() {
  const {
    status, // ArchitectureModificationStatus
    steps, // StepProgress[]
    result, // PipelineCompleteData | null
    error, // string | null
    modify, // (intent: string) => Promise<void>
    abort, // () => void
    reset, // () => void
    acceptPatches, // () => Promise<AcceptResult>
    rejectPatches, // (reason?: string) => Promise<RejectResult>
  } = useArchitectureModification();

  // ...
}
```

### Initiating Modification

```typescript
async function handleIntentSubmit(intent: string) {
  // status transitions: idle → streaming → completed | failed
  await modify(intent);
}
```

The `modify` function:

1. Sets status to `streaming`
2. POSTs to `/api/architecture/modify/stream` with the intent
3. Parses SSE events, updating `steps` with progress
4. On `pipeline_complete`, sets `result` and status to `completed`
5. On any error, sets `error` and status to `failed`

### Accepting Patches

```typescript
async function handleAccept() {
  if (!result?.transactionId) {
    throw new Error("No transaction to accept");
  }

  try {
    const acceptResult = await acceptPatches();
    // { success: true, transactionId: "...", status: "committed", patchesApplied: N, lintPassed: true }
  } catch (err) {
    // Handle rejection - e.g., show lint errors to user
    console.error("Accept failed:", err.message);
  }
}
```

### Rejecting Patches

```typescript
async function handleReject(reason?: string) {
  if (!result?.transactionId) {
    throw new Error("No transaction to reject");
  }

  try {
    const rejectResult = await rejectPatches(reason ?? "User rejected");
    // { success: true, transactionId: "...", status: "rolled_back", reason: "..." }
  } catch (err) {
    console.error("Reject failed:", err.message);
  }
}
```

### Displaying Step Progress

```typescript
function StepProgress({ steps }: { steps: StepProgress[] }) {
  return (
    <ul>
      {steps.map((step) => (
        <li key={step.name}>
          {step.name}: {step.status}
          {step.durationMs != null && ` (${step.durationMs}ms)`}
        </li>
      ))}
    </ul>
  );
}
```

### Displaying Patch Review Panel

When `status === "completed"` and `result` is available, display the `PatchReviewPanel` component:

```typescript
function PatchReview({ result, onAccept, onReject }: {
  result: PipelineCompleteData;
  onAccept: () => void;
  onReject: (reason?: string) => void;
}) {
  return (
    <div>
      <h3>Generated Changes ({result.patches.length} patches)</h3>
      {result.lintPassed === false && (
        <div className="lint-warning">
          Lint validation found issues. Changes will be rejected if lint fails on accept.
        </div>
      )}
      <PatchList patches={result.patches} />
      <button onClick={onAccept}>Accept Changes</button>
      <button onClick={onReject}>Reject Changes</button>
    </div>
  );
}
```

---

## Code Examples

### Minimal Integration

```typescript
"use client";

import { useState } from "react";
import { useArchitectureModification } from "@/features/governance-assistant/hooks/useArchitectureModification";

export default function ArchitectureModifier() {
  const [intent, setIntent] = useState("");
  const {
    status,
    steps,
    result,
    error,
    modify,
    acceptPatches,
    rejectPatches,
    reset,
  } = useArchitectureModification();

  return (
    <div>
      <textarea
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        placeholder="Describe the architecture change you want..."
      />

      <button
        onClick={() => modify(intent)}
        disabled={status === "streaming" || !intent.trim()}
      >
        {status === "streaming" ? "Generating..." : "Generate Changes"}
      </button>

      {status === "streaming" && (
        <div>
          <h4>Progress</h4>
          <StepProgress steps={steps} />
        </div>
      )}

      {status === "completed" && result && (
        <div>
          <h4>Review Changes</h4>
          <p>{result.patches.length} patches generated</p>
          <button onClick={acceptPatches}>Accept</button>
          <button onClick={() => rejectPatches()}>Reject</button>
        </div>
      )}

      {status === "failed" && (
        <div className="error">
          Error: {error}
          <button onClick={reset}>Try Again</button>
        </div>
      )}
    </div>
  );
}
```

### SSE Event Handling (Manual Implementation)

If not using the hook, handle SSE manually:

```typescript
async function streamModification(intent: string) {
  const response = await fetch("/api/architecture/modify/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
      } else if (trimmed.startsWith("data: ") && currentEvent) {
        const data = trimmed.slice(6);
        const parsed = JSON.parse(data);
        handleEvent(currentEvent, parsed);
        currentEvent = "";
      }
    }
  }
}

function handleEvent(event: string, data: unknown) {
  switch (event) {
    case "pipeline_complete":
      // Store transactionId and patches for accept/reject phase
      break;
    case "pipeline_error":
      // Handle error
      break;
  }
}
```

---

## Lint Validation and Rollback Behavior

### On Accept

1. **Patch application**: Patches are applied to the manifest file
2. **Lint validation**: `LintValidation.validateManifest()` runs against the manifest
3. **If lint passes**: Transaction is committed, success returned
4. **If lint fails**:
   - Manifest is restored from git via `ManifestMutation.restoreFromGit()`
   - Transaction is rolled back
   - Lint errors are returned in the response
   - User sees lint errors and can modify intent or cancel

### On Reject

1. **Manifest restore**: Git restore is called defensively (failure is logged but ignored)
2. **Transaction rollback**: Transaction is rolled back with user-provided reason
3. **Response**: Success with `status: "rolled_back"`

---

## Troubleshooting

### "Transaction is in 'committed' state"

**Cause**: Attempting accept/reject on a transaction that is not in `speculative` state.

**Solution**: Refresh the transaction state. If it was already committed, no action needed. If it was rolled back, start a new modification request.

### "Lint validation failed. Patches reverted."

**Cause**: The generated patches, when applied, caused lint validation errors.

**Solution**: Review the `lintErrors` array in the response. Common causes:

- Generated patches target files that don't exist
- Generated patches violate manifest schema constraints
- Generated patches conflict with existing bounded contexts or ports

### "No active transaction to accept"

**Cause**: `acceptPatches()` called but `result.transactionId` is null/undefined.

**Solution**: Ensure `status === "completed"` and `result` is non-null before calling accept/reject.

### SSE stream closes without pipeline_complete

**Cause**: Network error, server crash, or client abort.

**Solution**: Check `error` state. Re-call `modify()` to restart the pipeline.

### 409 Conflict on accept/reject

**Cause**: Transaction is in an invalid state for the requested operation.

**Solution**: Verify transaction state. Use `TransactionManager.get(transactionId)` to inspect. Common scenarios:

- Transaction already committed → nothing to accept/reject
- Transaction already rolled back → nothing to accept/reject
- Transaction in `pending` state → wait for `speculative`
