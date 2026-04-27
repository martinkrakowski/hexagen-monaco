# ADR-0013: Timing Test Policy — Eliminate Flakiness in Test Suite

**Status**: ACCEPTED (Phase 6.1, 2026-04-27)

**Context**:

- HexaGen Monaco test suite (70+ tests, Phases 6A–6D) contained 108+ timing-dependent patterns
- Tests failed under CPU throttling (CI runners, battery-saver mode), high system load (parallel execution), filesystem latency (network mounts), and JavaScript event loop scheduling variations
- Flakiness undermined CI reliability and user confidence in test results

**Problem Statement**:
Tests that rely on hard-coded timing windows (e.g., `expect(elapsed).toBeLessThan(70)` or `setTimeout(resolve, 50)` for synchronization) are fundamentally brittle because:

1. System load varies (CPU throttling, parallel test execution)
2. Filesystem latency varies (network mounts, encrypted disks, HDD vs SSD)
3. Event loop scheduling is not deterministic without explicit control
4. Timing "good enough" for local development fails in CI

**Decision**:
Tests MUST verify behavior contracts, NOT implementation timing. There is one exception: SLA/performance tests that intentionally measure latency SHALL use Vitest fake timers for deterministic control.

---

## Principles

### ✅ ALLOWED Patterns

#### 1. Behavior-Based Async Verification

```typescript
// Verify operation completes (no timing window)
const result = await adapter.execute();
expect(result.success).toBe(true);
```

#### 2. Event Loop Responsiveness (Microtask Queue)

```typescript
// Verify event loop processes microtasks = non-blocking
let eventLoopResponsive = false;
adapter.startAsync();
await Promise.resolve().then(() => {
  eventLoopResponsive = true;
});
expect(eventLoopResponsive).toBe(true);
```

#### 3. State Polling (Explicit Condition)

```typescript
// Poll until condition or timeout
await waitFor(() => expect(state.ready).toBe(true), {
  timeout: 1000, // Safety limit only, not the test intent
});
```

#### 4. Fake Timers for SLA/Performance Tests

```typescript
vi.useFakeTimers();
const promise = operation();
await vi.advanceTimersByTimeAsync(150);
expect(performance.now() - start).toBe(150);
await promise;
vi.useRealTimers();
```

#### 5. Timestamp Generation for Test Data

```typescript
// Safe: generating unique IDs, not asserting on time
const txId = `tx-${Date.now()}`;
const version = `v1-${Date.now()}`;
```

---

### ❌ FORBIDDEN Patterns

#### 1. Hard-Coded Timing Windows

```typescript
// ❌ FORBIDDEN
const elapsed = Date.now() - start;
expect(elapsed).toBeLessThan(70);
```

**Why**: Fails under CPU throttling, system load, or network latency.

#### 2. Arbitrary Delays for Synchronization

```typescript
// ❌ FORBIDDEN
await new Promise((resolve) => setTimeout(resolve, 50));
expect(someCondition).toBe(true);
```

**Why**: Assumes 50ms is sufficient; fails under load. Use explicit condition polling instead.

#### 3. Assumptions About System Performance

```typescript
// ❌ FORBIDDEN
await new Promise((resolve) => setTimeout(resolve, 20)); // "Let filesystem settle"
```

**Why**: Filesystem mtime resolution varies by device. Use stat comparison instead.

#### 4. Performance.now() Assertions (Without Fake Timers)

```typescript
// ❌ FORBIDDEN (outside fake timers)
const start = performance.now();
await operation();
expect(performance.now() - start).toBeLessThan(100);
```

**Why**: Wall-clock timing varies with system load. Use fake timers (see Allowed #4).

---

## Implementation Rules

### Rule 1: Categorize Every Timing Pattern

When encountering `setTimeout`, `Date.now()`, `performance.now()`, or timing assertions:

1. **Data Generation**: (Safe) Used only for IDs/versions? → Keep as-is, document intent
2. **Arbitrary Delay**: (Forbidden) Used for synchronization? → Replace with explicit condition
3. **Performance Measurement**: (Forbidden w/o fake timers) Measuring operation latency? → Migrate to fake timers (SLA tests) or remove (happy-path tests)
4. **Timing Assertion**: (Forbidden) Using `expect(X).toBeLessThan(ms)`? → Replace with behavior verification

### Rule 2: Remove Before Migrating

Always attempt behavior-based replacement first:

- Arbitrary delays → explicit polling (`waitFor`, `expect(state).toBe(...)`)
- Timing assertions → data structure assertions (`expect(result).toBeDefined()`)
- Performance measurements → fake timers (if SLA test) or behavior verification (if happy-path test)

### Rule 3: Fake Timers Only for SLA Tests

Use `vi.useFakeTimers()` ONLY when:

- ✅ Test is explicitly about performance (SLA, latency percentiles, throughput)
- ✅ Test name contains "performance", "sla", "latency", or "throughput"
- ❌ Test is happy-path or error-recovery (use behavior assertions instead)

### Rule 4: Document Why

Every timing pattern should have a comment explaining its intent:

```typescript
// ✅ Good: Intent is clear
// Generate unique ID for this test run (not time-sensitive)
const sessionId = `session-${Date.now()}`;

// ✅ Good: Behavior-based
// Start operation (non-blocking)
adapter.process().catch(() => {});
// Event loop processes microtasks before operation completes
await Promise.resolve();
expect(microtaskExecuted).toBe(true);
```

---

## Consequences

### Positive

- ✅ Tests pass reliably under any system load (CPU throttling, parallel execution)
- ✅ CI pipelines stable (no flaky failures, no false negatives)
- ✅ Works on slow hardware (HDD, encrypted filesystems, network storage)
- ✅ Faster feedback loops (no arbitrary 50–100ms waits)
- ✅ Maintainability (clear test intent, not timing magic)
- ✅ Improved debugging (test failures indicate real problems, not timing luck)

### Neutral

- Tests take slightly less time overall (removed arbitrary delays)
- Requires different testing patterns than initial Phase 6A–6D code
- SLA tests become more explicit (fake timers require setup/teardown)

---

## Compliance Mechanisms

### Pre-Commit Hook (yarn lint)

ESLint rule enforces:

```typescript
// ❌ Warn on:
setTimeout(...)  // Without corresponding vi.useFakeTimers()
expect(...).toBeLessThan(...)  // When measuring time without fake timers
Date.now() in assertions  // Without context (data gen vs timing assertion)
```

### Test Execution (yarn test)

All tests run 3+ times in succession to catch flakiness:

```bash
yarn test --run --repeat 3
```

### Stress Test (Pre-Commit CI)

100-run validation to confirm 0 flakiness:

```bash
for i in {1..100}; do
  yarn test --run packages/web-driver packages/governance packages/external-integration
  [ $? -ne 0 ] && echo "FAIL at iteration $i" && exit 1
done
```

---

## Migration Path (Phase 6.1)

### Stage 1: Quick Wins (Remove Arbitrary Delays)

**11 instances** → Replace with explicit polling or error injection  
**Impact**: Immediate reduction in test time and flakiness vectors

### Stage 2: SLA Test Hardening (Fake Timers)

**11 SLA/performance tests** → Migrate to deterministic fake timers  
**Impact**: SLA assertions become deterministic, pass 100% of the time

### Stage 3: Verification & Stress Test

**All Phase 6A–6D tests** → Run 100+ iterations, confirm 0 flakiness  
**Impact**: Confidence in CI reliability

---

## Related ADRs

- ADR-0009: Published CLI Bundling (testing strategy context)

## References

- Vitest Docs: https://vitest.dev/guide/features.html#fake-timers
- Jest Fake Timers: https://jestjs.io/docs/en/timer-mocks (conceptual reference)
- Phase 6.1 Audit: `packages/web-driver/src/__tests__/TIMING-AUDIT.md`

---

**Next Action**: Implement Stage 1–3 fixes per Phase 6.1 work plan.
