# ADR-0029: Governance Panel Storage Lifecycle & State Management

**Status**: ACCEPTED (2026-04-28) — amended by ADR-0051 (2026-08-23): §1.3/§1.4 subscriber-driven purge no longer describes the code; see the 2026-08-15 note in §1.3

**Context**:

The Governance Panel in HexaGen Monaco manages three critical user interaction flows:

1. Project wizard Q&A threads with local/cloud LLM
2. Violations and suggestions display with conversational context
3. Cloud LLM connection state and streaming responses

Three architectural defects were identified in production:

1. **Storage Leakage**: When users discard a project and start a new one, wizard draft answers persist in localStorage, causing state pollution across project boundaries
2. **State Destruction**: When users click the Violations tab, Q&A accordion thread state is destroyed and unrecoverable because threads are stored in component-local state
3. **Infinite Loader**: When users switch to Cloud LLM mode, the connection attempt lacks timeout guards and FSM state transitions, leaving users stranded on an infinite loader

**Problem Statement**:

### Issue 1: Storage Leakage

- Wizard drafts stored in localStorage with single key `hexagen-wizard-draft`
- No project-scoped cleanup on `handleDiscardAndNew()`
- Race condition: new project can hydrate stale draft before purge completes
- Split-brain storage: localStorage for wizard, IndexedDB for chat threads

### Issue 2: State Destruction

- Thread state lives in `useGovernanceThread` hook's local `useState`
- Violations section is standalone div, not accordion peer
- Tab switching unmounts components → destroys thread state
- No state hoisting or persistence between view changes

### Issue 3: Infinite Loader

- `useCloudLLM` status: `idle | streaming | error` (no `connecting` state)
- No timeout on `fetch()` call to `/api/llm/chat`
- No `AbortController` to cancel orphaned requests
- Unhandled promise rejections swallowed by try/catch

**Decision**:

Implement three-phase remediation with architectural boundaries enforced via Ports and Adapters:

---

## Phase 1: Project Lifecycle & Storage Governance

### 1.1 Domain Event Layer

**Rationale**: Decouple project disposal intent from storage implementation

Create `ProjectDiscardedEvent` in domain layer:

```typescript
// packages/monaco-orchestration/src/domain/events/project-discarded.event.ts
export interface ProjectDiscardedEvent {
  projectId: string;
  timestamp: Date;
  reason: "user_initiated" | "error";
}
```

Wire through existing `EventBusPort` in `wire.client.ts`.

### 1.2 Storage Unification Strategy

**Rationale**: Eliminate split-brain storage lifecycle management

**Decision**: Migrate wizard drafts from localStorage to IndexedDB

**Justification**:

- IndexedDB already used for chat threads (`IDBChatPersistenceAdapter`)
- Enables atomic transactions across wizard + threads + workspace
- Consistent purge strategy via single transaction
- Avoids localStorage quota issues with large wizard state

**Implementation**:

1. Extend `IDBChatPersistenceAdapter` with `wizardDrafts` object store
2. Key format: `${projectId}-wizard-draft`
3. Deprecate localStorage `WIZARD_DRAFT_KEY` after migration
4. Add migration path for existing localStorage drafts

### 1.3 Adapter Cleanup with Transaction Safety

**Rationale**: Prevent UI race conditions during I/O operations

Add `purgeProjectData(projectId)` method to persistence adapter:

- Opens IDB transaction across `wizardDrafts`, `chatThreads`, `workspaces` stores
- Deletes all project-scoped data atomically using `IDBKeyRange`
- Returns `Promise<Result<void, PersistenceError>>` for error handling
- Subscribes to `ProjectDiscarded` event via EventBus

**Critical**: Transaction must complete before UI state reset to prevent:

- New project hydrating stale data mid-purge
- User seeing inconsistent state during cleanup

### 1.4 State Synchronization with I/O Guard

**Rationale**: Guarantee cleanup completes before state reset

Modify `useProjectLifecycle.handleDiscardAndNew()`:

1. Emit `ProjectDiscarded` event (domain intent)
2. `await persistence.purgeProjectData(projectId)` (I/O completion)
3. Reset form + UI state (only after I/O succeeds)

This ordering prevents race condition where new project initializes before old project data is purged.

> **Amended 2026-08-15 (plan item 5.3(c), ADR-0051 §Consequences).** §1.3's
> "Subscribes to `ProjectDiscarded` event via EventBus" and §1.4's implied
> subscriber-driven cleanup no longer describe the code. `ProjectDiscarded` is
> now **announcement-only** and has no subscribers; the purge cascade is owned
> by the `discardProject` use case
> (`apps/web/app/lib/use-cases/project-lifecycle.use-case.ts`), which publishes
> the event and then awaits the purge. The subscriber lived in the client
> composition root and `discardProject` also purged inline, so every discard
> purged chat persistence twice — the subscriber was removed rather than the
> inline purge. The §1.4 ordering guarantee is unchanged and now enforced
> inside `discardProject`. Do not reintroduce a purging subscriber.

### 1.5 Hydration Guard

**Rationale**: Reject stale drafts that survive purge race

Add projectId validation in `useWizardDraft.loadDraft()`:

```typescript
if (result.value.projectId !== currentProjectId) {
  await persistence.clearDraft();
  return null; // Force clean slate
}
```

---

## Phase 2: Component Isolation & State Hoisting

### 2.1 Atomic State Management with Zustand

**Rationale**: Prevent render thrashing during LLM streaming

**Decision**: Replace React Context with Zustand + Immer middleware

**Justification**:

- React Context forces full re-render of all consumers on any state change
- During LLM streaming, `messages` array updates tick-by-tick (60+ updates/sec)
- Zustand provides atomic selectors → only consuming components re-render
- Immer middleware enables immutable updates without spread operators
- No Provider wrapper needed (simpler DX)

**Implementation**:

```typescript
// apps/web/app/contexts/AIGovernanceContext.tsx
export const useAIGovernanceStore = create<AIGovernanceStore>()(
  immer((set, get) => ({
    threads: Record<string, ThreadState>,
    updateThreadMessage: (threadId, messageIndex, content) =>
      set((state) => {
        state.threads[threadId].messages[messageIndex].answer = content;
      }),
  })),
);
```

### 2.2 Render Optimization with React.memo

**Rationale**: Prevent unnecessary re-renders of collapsed accordions

Wrap `QuestionAccordion` with `React.memo` and custom comparison:

```typescript
const MemoizedQuestionAccordion = React.memo(
  QuestionAccordion,
  (prev, next) =>
    prev.isExpanded === next.isExpanded &&
    prev.question.id === next.question.id,
);
```

Only re-render when accordion's own props change, not when sibling threads update.

### 2.3 Convert Violations to Accordion Peer

**Rationale**: Unified interaction model prevents state loss

Replace standalone Violations div with `QuestionAccordion` component:

- Violations become accordion item with id `'violations'`
- Thread state stored in Zustand store like Q&A threads
- Collapsing/expanding no longer unmounts component
- State persists across tab switches

### 2.4 Hoist Thread State to Store

**Rationale**: Decouple thread lifecycle from component lifecycle

Modify `useGovernanceThread`:

- Replace local `useState` with Zustand store access
- Load effect writes to store instead of local state
- Thread survives component unmount/remount
- Enables cross-component thread access (future: thread history panel)

### 2.5 Persistence Strategy

Extend IndexedDB `chatThreads` object store:

- Key format: `${projectId}-${threadId}`
- Special key for violations: `${projectId}-violations`
- Purged atomically in Phase 1.3 transaction

---

## Phase 3: Async Resilience & Connection State

### 3.1 Finite State Machine with Connection State

**Rationale**: Explicit state transitions prevent infinite loader

**Decision**: Expand `CloudLLMStatus` to include `connecting` state

```typescript
type CloudLLMStatus =
  | { status: "idle" }
  | { status: "connecting"; startedAt: number; attempt: number }
  | { status: "connected"; provider: string; model: string }
  | { status: "streaming" }
  | { status: "error"; message: string; retryable: boolean };
```

UI can now display:

- Spinner during `connecting` (with attempt count)
- Success indicator on `connected`
- Error message + retry button on `error`

### 3.2 Timeout + AbortController Integration

**Rationale**: Prevent orphaned network requests and resource leaks

**Decision**: Race `fetch()` against 10-second timeout with `AbortController`

**Implementation**:

```typescript
const abortController = new AbortController();
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => {
    abortController.abort(); // Cancel network request
    reject(new Error("Connection timeout"));
  }, 10000),
);

const response = await Promise.race([
  fetch(CHAT_ENDPOINT, { signal: abortController.signal }),
  timeoutPromise,
]);
```

**Benefits**:

- Timeout triggers `AbortError` → caught and handled gracefully
- Browser cancels in-flight request (no orphaned connections)
- User sees actionable error message instead of infinite spinner
- Retry button available for transient network issues

### 3.3 Retry Logic with Exponential Backoff

**Rationale**: Handle transient failures without overwhelming API

Add `retryConnection()` method:

- Tracks attempt count in FSM state
- Exponential backoff: 1s, 2s, 4s, 8s, 10s (capped)
- Only retryable errors show retry button
- Non-retryable errors (auth failures) show configuration link

### 3.4 UI Error Boundary

**Rationale**: Graceful degradation on connection failures

Display connection state in `CloudModelSettingsView`:

- `connecting`: Spinner + "Connecting... (attempt N)"
- `error`: Error message + retry button (if retryable)
- Suggest checking API keys/network on timeout

---

## Telemetry Strategy for Domain Events

**Decision**: Design EventBus for future remote logging, keep local for MVP

**Rationale**:

- Domain events (`ProjectDiscarded`, `CloudLLMTimeout`) are valuable telemetry signals
- GaaS backend not yet deployed → remote logging premature
- Design adapter interface now to avoid refactoring later

**Implementation**:

```typescript
// packages/messaging/src/infrastructure/adapters/in-memory-event-bus.adapter.ts
export class InMemoryEventBusAdapter implements EventBusPort {
  private telemetryAdapter?: TelemetryPort;

  setTelemetryAdapter(adapter: TelemetryPort) {
    this.telemetryAdapter = adapter;
  }

  emit<T>(eventName: string, payload: T): void {
    // Local subscribers (immediate)
    this.subscribers.get(eventName)?.forEach((cb) => cb(payload));

    // Remote telemetry (fire-and-forget, non-blocking)
    if (this.telemetryAdapter) {
      this.telemetryAdapter.track(eventName, payload).catch(() => {});
    }
  }
}
```

**Events to Track**:

- `ProjectDiscarded` → project lifecycle metrics
- `CloudLLMTimeout` → API reliability monitoring
- `StoragePurgeFailed` → data integrity alerts

**Future Integration**: When GaaS backend deploys, inject `RemoteTelemetryAdapter` via dependency injection without modifying EventBus implementation.

---

## Consequences

### Positive

- **Data Integrity**: Atomic purge prevents cross-project state pollution
- **User Experience**: Thread state survives view changes, no data loss
- **Reliability**: Timeout guards prevent infinite loaders, clear error messages
- **Maintainability**: Domain events decouple intent from implementation
- **Performance**: Zustand + React.memo prevent render thrashing during streaming
- **Future-Proof**: Telemetry hooks ready for GaaS integration

### Negative

- **Migration Complexity**: localStorage → IndexedDB requires data migration path
- **Bundle Size**: Zustand adds ~3KB (acceptable for benefits)
- **Testing Surface**: FSM state transitions require comprehensive test coverage

### Neutral

- **Breaking Change**: Phase 2 requires wrapping app in Zustand provider (one-line change)
- **Backward Compatibility**: Phase 1 and 3 are additive, no breaking changes

---

## Implementation Timeline

**Phase 1** (Data Integrity) - 2-3 days

- Domain events + storage unification
- Highest priority: prevents data loss

**Phase 3** (Unblock Users) - 1-2 days

- FSM + timeout guards
- Unblocks Cloud LLM users

**Phase 2** (UX Polish) - 2-3 days

- State hoisting + render optimization
- Non-blocking improvement

**Total Estimate**: 5-8 days with testing

---

## References

- [ADR-0028: Accept/Reject Flow](./ADR-0028-accept-reject-flow.md) - Transaction state machine precedent
- [ADR-0015: Editor Workspace Persistence](./ADR-0015-editor-workspace-persistence.md) - Persistence patterns
- [ADR-0017: Local LLM Domain-Driven Refactoring](./ADR-0017-local-llm-domain-driven-refactoring.md) - LLM architecture
