import { describe, it } from "vitest";
import assert from "node:assert";
import { createQuotaStore, QUOTA_LIMITS } from "../quota-store";

describe("quota-store", () => {
  it("counts a request and reports remaining", () => {
    const store = createQuotaStore(":memory:");
    const r = store.consume("s1", "generation");
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.used, 1);
    assert.strictEqual(r.limit, QUOTA_LIMITS.generation);
    assert.strictEqual(r.remaining, QUOTA_LIMITS.generation - 1);
    store.close();
  });

  it("denies once the daily cap is reached, without over-counting", () => {
    const store = createQuotaStore(":memory:");
    for (let i = 0; i < QUOTA_LIMITS.generation; i++) {
      assert.strictEqual(store.consume("s", "generation").allowed, true);
    }
    const over = store.consume("s", "generation");
    assert.strictEqual(over.allowed, false);
    assert.strictEqual(over.remaining, 0);
    assert.strictEqual(over.used, QUOTA_LIMITS.generation); // capped, not limit+1
    // A second over-limit call stays denied and still doesn't count up.
    assert.strictEqual(
      store.consume("s", "generation").used,
      QUOTA_LIMITS.generation,
    );
    store.close();
  });

  it("tracks kinds independently (generation cap doesn't touch chat)", () => {
    const store = createQuotaStore(":memory:");
    for (let i = 0; i < QUOTA_LIMITS.generation; i++) {
      store.consume("s", "generation");
    }
    assert.strictEqual(store.consume("s", "generation").allowed, false);
    assert.strictEqual(store.consume("s", "chat").allowed, true);
    store.close();
  });

  it("tracks sessions independently", () => {
    const store = createQuotaStore(":memory:");
    for (let i = 0; i < QUOTA_LIMITS.generation; i++) {
      store.consume("a", "generation");
    }
    assert.strictEqual(store.consume("a", "generation").allowed, false);
    assert.strictEqual(store.consume("b", "generation").allowed, true);
    store.close();
  });

  it("resets across a UTC-midnight day rollover", () => {
    const store = createQuotaStore(":memory:");
    const lateJun14 = Date.UTC(2026, 5, 14, 23, 0); // 23:00 UTC
    for (let i = 0; i < QUOTA_LIMITS.chat; i++) {
      store.consume("s", "chat", lateJun14);
    }
    assert.strictEqual(store.consume("s", "chat", lateJun14).allowed, false);

    const earlyJun15 = Date.UTC(2026, 5, 15, 1, 0); // 01:00 UTC next day
    const after = store.consume("s", "chat", earlyJun15);
    assert.strictEqual(after.allowed, true);
    assert.strictEqual(after.used, 1);
    store.close();
  });

  it("reports resetAt as the next UTC midnight", () => {
    const store = createQuotaStore(":memory:");
    const now = Date.UTC(2026, 5, 14, 10, 30);
    const r = store.consume("s", "generation", now);
    assert.strictEqual(r.resetAt, Date.UTC(2026, 5, 15, 0, 0, 0, 0));
    store.close();
  });

  it("peek does not consume; snapshot covers every kind", () => {
    const store = createQuotaStore(":memory:");
    store.consume("s", "generation");
    assert.strictEqual(store.peek("s", "generation").used, 1);
    assert.strictEqual(store.peek("s", "generation").used, 1); // still 1

    const snap = store.snapshot("s");
    assert.strictEqual(snap.generation.used, 1);
    assert.strictEqual(snap.generation.remaining, QUOTA_LIMITS.generation - 1);
    assert.strictEqual(snap.chat.used, 0);
    store.close();
  });
});
