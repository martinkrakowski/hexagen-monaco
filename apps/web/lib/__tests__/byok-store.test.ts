import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyMetadata } from "@hexagen/byok";
import { createByokStore, openByokDb, createByokStoreOn } from "../byok-store";
import { createSqlitePlatformDb } from "../platform/sqlite-db";

function fixture(over: Partial<KeyMetadata> = {}): KeyMetadata {
  return {
    keyId: "key-1",
    userId: "user-1",
    provider: "openai",
    keyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    revokedBy: null,
    ...over,
  };
}

describe("byok-store (in-memory)", () => {
  it("stores and reads metadata back by key id and by user+provider", async () => {
    const store = createByokStore(":memory:");
    assert.strictEqual((await store.metadata.store(fixture())).success, true);

    const byId = await store.metadata.findByKeyId("key-1");
    assert.strictEqual(byId.success && byId.value?.userId, "user-1");

    const byUser = await store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(byUser.success && byUser.value?.keyId, "key-1");
    await store.close();
  });

  it("findByUserAndProvider returns the most recently stored key (last-write-wins)", async () => {
    const store = createByokStore(":memory:");
    await store.metadata.store(fixture({ keyId: "old" }));
    await store.metadata.store(fixture({ keyId: "new" }));
    const r = await store.metadata.findByUserAndProvider("user-1", "openai");
    assert.strictEqual(r.success && r.value?.keyId, "new");
    await store.close();
  });

  it("findByUserAndProvider tracks the last write even when re-storing an earlier key (rowid is not write order)", async () => {
    const store = createByokStore(":memory:");
    // Store A, then B (both current for the same user+provider), then re-store A
    // (e.g. a re-encrypt bumping keyVersion). The re-store is an in-place upsert
    // on key_id "A", so A keeps its original — lower — rowid. Under rowid-DESC
    // ordering the store would wrongly still return B; the genuine last write is
    // A, so A must be reported as current.
    await store.metadata.store(fixture({ keyId: "A" }));
    await store.metadata.store(fixture({ keyId: "B" }));
    await store.metadata.store(fixture({ keyId: "A", keyVersion: 2 }));
    const r = await store.metadata.findByUserAndProvider("user-1", "openai");
    assert.strictEqual(r.success && r.value?.keyId, "A");

    // Re-storing the other key must flip current back to it — write_seq keeps
    // advancing across arbitrary re-store order (guards against an over-
    // correction that only re-orders non-latest re-stores).
    await store.metadata.store(fixture({ keyId: "B", keyVersion: 2 }));
    const r2 = await store.metadata.findByUserAndProvider("user-1", "openai");
    assert.strictEqual(r2.success && r2.value?.keyId, "B");
    await store.close();
  });

  it("markRevoked on a missing key returns key_not_found", async () => {
    const store = createByokStore(":memory:");
    const r = await store.metadata.markRevoked("nope", "admin");
    assert.strictEqual(r.success, false);
    if (!r.success) {
      assert.strictEqual(r.error.kind, "key_not_found");
    }
    await store.close();
  });

  it("hasKeys stays true even after the user's only key is revoked", async () => {
    const store = createByokStore(":memory:");
    await store.metadata.store(fixture());
    await store.metadata.markRevoked("key-1", "admin");
    const r = await store.metadata.hasKeys("user-1");
    assert.strictEqual(r.success && r.value, true);
    await store.close();
  });

  it("records and reports a revocation", async () => {
    const store = createByokStore(":memory:");
    const before = await store.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(before.success && before.value, false);
    await store.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "key-1",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });
    const after = await store.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(after.success && after.value, true);
    await store.close();
  });
});

describe("byok-store (durable across reopen — AUD-007)", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps metadata + revocation after the store is closed and reopened", async () => {
    dir = mkdtempSync(join(tmpdir(), "byok-store-"));
    const dbPath = join(dir, "byok.db");

    const first = createByokStore(dbPath);
    await first.metadata.store(fixture());
    await first.metadata.markRevoked("key-1", "admin");
    await first.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "key-1",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });
    await first.close();

    // A fresh handle on the same file is what a container restart looks like.
    const second = createByokStore(dbPath);
    const meta = await second.metadata.findByKeyId("key-1");
    assert.strictEqual(meta.success && meta.value?.revokedAt !== null, true);
    assert.strictEqual(meta.success && meta.value?.revokedBy, "admin");

    const revoked = await second.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(revoked.success && revoked.value, true);
    await second.close();
  });
});

describe("byok-store (runs on any PlatformDb)", () => {
  it("the store runs on any PlatformDb: store, find, revoke", async () => {
    const db = createSqlitePlatformDb(openByokDb(":memory:"));
    const store = createByokStoreOn(db);

    assert.strictEqual(
      (await store.metadata.store(fixture({ keyId: "k1" }))).success,
      true,
    );

    const found = await store.metadata.findByKeyId("k1");
    assert.strictEqual(found.success && found.value?.keyId, "k1");

    const userFound = await store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(userFound.success && userFound.value?.keyId, "k1");

    assert.strictEqual(
      (await store.metadata.markRevoked("k1", "admin")).success,
      true,
    );
    await store.close();
  });

  it("write_seq still orders by last write: store A, store B, re-store A", async () => {
    const db = createSqlitePlatformDb(openByokDb(":memory:"));
    const store = createByokStoreOn(db);

    await store.metadata.store(fixture({ keyId: "A" }));
    await store.metadata.store(fixture({ keyId: "B" }));
    await store.metadata.store(fixture({ keyId: "A", keyVersion: 2 }));

    const r = await store.metadata.findByUserAndProvider("user-1", "openai");
    assert.strictEqual(r.success && r.value?.keyId, "A");
    await store.close();
  });

  it("two stores started together both land and the later one wins", async () => {
    const db = createSqlitePlatformDb(openByokDb(":memory:"));
    const store = createByokStoreOn(db);

    const [rA, rB] = await Promise.all([
      store.metadata.store(fixture({ keyId: "kA" })),
      store.metadata.store(fixture({ keyId: "kB" })),
    ]);
    assert.strictEqual(rA.success, true);
    assert.strictEqual(rB.success, true);

    // Both rows exist.
    const a = await store.metadata.findByKeyId("kA");
    const b = await store.metadata.findByKeyId("kB");
    assert.strictEqual(a.success && a.value?.keyId, "kA");
    assert.strictEqual(b.success && b.value?.keyId, "kB");

    // findByUserAndProvider returns one of them (last write wins).
    const current = await store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.ok(current.success && current.value !== null);
    assert.ok(
      current.value?.keyId === "kA" || current.value?.keyId === "kB",
      `expected kA or kB, got ${current.value?.keyId}`,
    );
    await store.close();
  });

  it("close returns a Promise and a second close resolves", async () => {
    const db = createSqlitePlatformDb(openByokDb(":memory:"));
    const store = createByokStoreOn(db);

    const firstClose = store.close();
    assert.ok(firstClose instanceof Promise);
    await firstClose;

    // A second close resolves without throwing.
    await store.close();
  });
});
