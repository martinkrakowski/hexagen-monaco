# ADR-0028: Two-Phase Architecture Modification Flow — Generate then Accept/Reject

**Status**: ACCEPTED (feature/a2ui-integration-hardening, 2026-04-27)

**Context**:

The architecture modification flow originally combined patch generation and manifest mutation into a single atomic operation. This design posed a risk: users had no opportunity to review AI-generated changes before they were committed to the manifest, and any lint violations would leave the system in an inconsistent state requiring manual intervention.

**Problem Statement**:

The original Flow 1 (`/api/architecture/modify`) would:

1. Accept a natural language intent
2. Execute the AI pipeline to generate patches
3. Immediately apply patches to the manifest
4. Return results

This created two problems:

1. **No user review**: Users could not inspect or modify patches before they affected `.architecture/manifest.yaml`
2. **No rollback on lint failure**: If lint validation failed after patches were applied, the system would call `git restore` defensively, but the transaction state was left inconsistent

**Decision**:

Split Flow 1 into two distinct phases:

### Phase 1: Generate (streaming)

- Endpoint: `POST /api/architecture/modify/stream`
- Executes AI pipeline and returns SSE stream of step progress
- Creates a transaction in `speculative` status
- Stores generated patches in transaction metadata
- Returns `transactionId` for use in Phase 2

### Phase 2: Accept or Reject (separate endpoints)

- `POST /api/architecture/modify/accept` — applies patches, validates lint, commits transaction
- `POST /api/architecture/modify/reject` — restores manifest from git, rolls back transaction

The transaction must be in `speculative` status for either accept or reject to succeed. This enforces that a user must explicitly review and act on the generated changes.

---

## Transaction State Machine

```
idle → speculative → committed  (accept)
                    ↘ rolled_back  (reject)
```

| State         | Transitions                | Description                                     |
| ------------- | -------------------------- | ----------------------------------------------- |
| `idle`        | (initial)                  | No active transaction                           |
| `speculative` | `committed`, `rolled_back` | Patches generated, awaiting user review         |
| `committed`   | —                          | Patches applied, lint passed, manifest updated  |
| `rolled_back` | —                          | User rejected or lint failed, manifest restored |

---

## Request/Response Schemas

### POST /api/architecture/modify/stream

**Request Body:**

```typescript
interface StreamRequestBody {
  intent: string; // Required: natural language intent
  manifestPath?: string; // Optional: defaults to ".architecture/manifest.yaml"
  lineage?: IntentLineage; // Optional: lineage tracking metadata
}
```

**SSE Events:**

- `pipeline_start` — `{ intent: string }`
- `step_running` — `{ name: string }`
- `step_complete` — `{ name: string, status: PipelineStepStatus, durationMs: number }`
- `pipeline_complete` — `{ pipelineRunId, patchesApplied, lintPassed, transactionId, patches }`
- `pipeline_error` — `{ error: string }`
- `error` — `{ type: "error", message: string }`

**Returns:** `text/event-stream`

### POST /api/architecture/modify/accept

**Request Body:**

```typescript
interface AcceptRequestBody {
  transactionId: string; // Required: from Phase 1 response
  manifestPath?: string; // Optional: defaults to ".architecture/manifest.yaml"
}
```

**Success Response (200):**

```typescript
{
  success: true,
  transactionId: string,
  status: "committed",
  patchesApplied: number,
  lintPassed: boolean
}
```

**Error Responses:**

- `400`: Missing `transactionId`
- `404`: Transaction not found
- `409`: Transaction not in `speculative` state
- `500`: Lint validation failed + git restore failed, or unexpected error

### POST /api/architecture/modify/reject

**Request Body:**

```typescript
interface RejectRequestBody {
  transactionId: string; // Required: from Phase 1 response
  manifestPath?: string; // Optional: defaults to ".architecture/manifest.yaml"
  reason?: string; // Optional: defaults to "User rejected"
}
```

**Success Response (200):**

```typescript
{
  success: true,
  transactionId: string,
  status: "rolled_back",
  reason: string
}
```

**Error Responses:**

- `400`: Missing `transactionId`
- `404`: Transaction not found
- `409`: Transaction not in `speculative` state
- `500`: Unexpected error

---

## Accept Flow: Lint Validation and Rollback

When `/api/architecture/modify/accept` is called:

1. **Apply patches** to manifest via `ManifestMutation.applyPatches()`
2. **Validate manifest** via `LintValidation.validateManifest()`
3. **If lint passes**: commit transaction, return success
4. **If lint fails**: restore manifest from git via `ManifestMutation.restoreFromGit()`, rollback transaction, return lint errors

This ensures the manifest is never left in an invalid state after an accept operation, even if lint validation fails.

---

## Alternatives Considered

### 1. Optimistic Updates (Immediate Apply + Async Validation)

Apply patches immediately, validate asynchronously, notify user of failures via notification.

**Rejected because:**

- User has no opportunity to review before changes affect manifest
- Requires complex notification system for async failure handling
- Rollback of committed changes requires git history traversal

### 2. Undo/Redo Instead of Accept/Reject

Keep original atomic flow, provide undo/redo capability for users to revert changes.

**Rejected because:**

- More complex implementation (command pattern + history stack)
- Undo is less explicit than reject — user may not realize changes were applied
- Does not solve the lint-on-commit problem

### 3. Three-Phase Flow (Generate → Preview → Confirm/Cancel)

Add an explicit "preview" phase where patches are displayed but not stored.

**Rejected because:**

- Frontend complexity — requires additional UI state for preview mode
- Transaction already serves as the preview mechanism (patches stored in metadata)
- Additional phase increases round-trip latency

---

## Consequences

### Positive

- Users can review AI-generated patches before any manifest mutation occurs
- Explicit accept/reject actions make the workflow transparent
- Lint failures are handled automatically with git restore — no manual intervention required
- Transaction state machine provides clear semantics for all code paths
- Streaming SSE provides real-time progress feedback during patch generation

### Negative

- Additional API calls required (stream → accept/reject vs single request)
- Frontend must manage transaction state between phases
- Transaction timeout must be handled (speculative transactions left hanging)

### Neutral

- Slight increase in perceived latency (two-phase vs atomic)
- More network round-trips, but each is simpler and more focused

---

## Related ADRs

- ADR-0009: Published CLI Bundling
- ADR-0013: Timing Test Policy
- ADR-0027: State Machine Evolution

## References

- `/api/architecture/modify/stream` — SSE streaming endpoint
- `/api/architecture/modify/accept` — Accept endpoint
- `/api/architecture/modify/reject` — Reject endpoint
- `useArchitectureModification` hook — Frontend React hook
- `packages/transaction-system` — Transaction state management
- `packages/reconciliation-engine` — Patch reconciliation with lint filtering
