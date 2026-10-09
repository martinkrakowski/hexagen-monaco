import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyMetadata } from "@hexagen/byok";
import { createByokStore, createByokStoreOn } from "../byok-store";
import { createPgPool, createPgPlatformDb } from "../platform/pg-db";
import { BACKENDS, openByokBackend } from "../../test-support/byok-backends";
import type { ByokBackend } from "../../test-support/byok-backends";
import { createTestPgDb } from "../../test-support/pg-test-db";

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

describe.each(BACKENDS)("byok-store (%s)", (kind) => {
  let backend: ByokBackend;
  beforeEach(async () => {
    backend = await openByokBackend(kind, { pgMax: 4 });
  });
  afterEach(async () => {
    await backend.close();
  });

  it("stores and reads metadata back by key id and by user+provider", async () => {
    assert.strictEqual(
      (await backend.store.metadata.store(fixture())).success,
      true,
    );

    const byId = await backend.store.metadata.findByKeyId("key-1");
    assert.strictEqual(byId.success && byId.value?.userId, "user-1");

    const byUser = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(byUser.success && byUser.value?.keyId, "key-1");
  });

  it("findByUserAndProvider returns the most recently stored key (last-write-wins)", async () => {
    await backend.store.metadata.store(fixture({ keyId: "old" }));
    await backend.store.metadata.store(fixture({ keyId: "new" }));
    const r = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(r.success && r.value?.keyId, "new");
  });

  it("findByUserAndProvider tracks the last write even when re-storing an earlier key (rowid is not write order)", async () => {
    // Store A, then B (both current for the same user+provider), then re-store A
    // (e.g. a re-encrypt bumping keyVersion). The re-store is an in-place upsert
    // on key_id "A", so A keeps its original — lower — rowid. Under rowid-DESC
    // ordering the store would wrongly still return B; the genuine last write is
    // A, so A must be reported as current.
    await backend.store.metadata.store(fixture({ keyId: "A" }));
    await backend.store.metadata.store(fixture({ keyId: "B" }));
    await backend.store.metadata.store(fixture({ keyId: "A", keyVersion: 2 }));
    const r = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(r.success && r.value?.keyId, "A");

    // Re-storing the other key must flip current back to it — write_seq keeps
    // advancing across arbitrary re-store order (guards against an over-
    // correction that only re-orders non-latest re-stores).
    await backend.store.metadata.store(fixture({ keyId: "B", keyVersion: 2 }));
    const r2 = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(r2.success && r2.value?.keyId, "B");
  });

  it("markRevoked on a missing key returns key_not_found", async () => {
    const r = await backend.store.metadata.markRevoked("nope", "admin");
    assert.strictEqual(r.success, false);
    if (!r.success) {
      assert.strictEqual(r.error.kind, "key_not_found");
    }
  });

  it("hasKeys stays true even after the user's only key is revoked", async () => {
    await backend.store.metadata.store(fixture());
    await backend.store.metadata.markRevoked("key-1", "admin");
    const r = await backend.store.metadata.hasKeys("user-1");
    assert.strictEqual(r.success && r.value, true);
  });

  it("records and reports a revocation", async () => {
    const before = await backend.store.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(before.success && before.value, false);
    await backend.store.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "key-1",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });
    const after = await backend.store.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(after.success && after.value, true);
  });

  // Decision 8 condition tests: each guards against a missing WHERE clause.
  it("findByUserAndProvider, hasKeys and isRevoked answer only the right user+provider pair", async () => {
    // Two users, two providers — 4 key rows, 2 revocation rows.
    await backend.store.metadata.store(
      fixture({ keyId: "u1-openai", userId: "user-1", provider: "openai" }),
    );
    await backend.store.metadata.store(
      fixture({ keyId: "u1-vertex", userId: "user-1", provider: "anthropic" }),
    );
    await backend.store.metadata.store(
      fixture({ keyId: "u2-openai", userId: "user-2", provider: "openai" }),
    );
    await backend.store.metadata.store(
      fixture({ keyId: "u2-vertex", userId: "user-2", provider: "anthropic" }),
    );

    await backend.store.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "u1-openai",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });
    await backend.store.revocation.revoke({
      userId: "user-2",
      provider: "anthropic",
      keyId: "u2-vertex",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });

    // findByUserAndProvider returns only the most recent for that pair.
    const u1o = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(u1o.success && u1o.value?.keyId, "u1-openai");
    const u1v = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "anthropic",
    );
    assert.strictEqual(u1v.success && u1v.value?.keyId, "u1-vertex");
    const u2o = await backend.store.metadata.findByUserAndProvider(
      "user-2",
      "openai",
    );
    assert.strictEqual(u2o.success && u2o.value?.keyId, "u2-openai");
    const u2v = await backend.store.metadata.findByUserAndProvider(
      "user-2",
      "anthropic",
    );
    assert.strictEqual(u2v.success && u2v.value?.keyId, "u2-vertex");

    // hasKeys is true for every user with at least one key.
    const has1 = await backend.store.metadata.hasKeys("user-1");
    assert.strictEqual(has1.success && has1.value, true);
    const has2 = await backend.store.metadata.hasKeys("user-2");
    assert.strictEqual(has2.success && has2.value, true);
    const has3 = await backend.store.metadata.hasKeys("user-3");
    assert.strictEqual(has3.success && has3.value, false);

    // isRevoked is true only for the pair that was revoked.
    const rev11 = await backend.store.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(rev11.success && rev11.value, true);
    const rev2a = await backend.store.revocation.isRevoked(
      "user-2",
      "anthropic",
    );
    assert.strictEqual(rev2a.success && rev2a.value, true);
    const rev1a = await backend.store.revocation.isRevoked(
      "user-1",
      "anthropic",
    );
    assert.strictEqual(rev1a.success && rev1a.value, false);
    const rev2o = await backend.store.revocation.isRevoked("user-2", "openai");
    assert.strictEqual(rev2o.success && rev2o.value, false);
  });

  it("markRevoked on one key leaves another key's revokedAt null", async () => {
    await backend.store.metadata.store(fixture({ keyId: "keep" }));
    await backend.store.metadata.store(
      fixture({ keyId: "revoke", userId: "user-2" }),
    );
    await backend.store.metadata.markRevoked("revoke", "admin");

    const kept = await backend.store.metadata.findByKeyId("keep");
    assert.strictEqual(kept.success && kept.value?.revokedAt, null);
    const revoked = await backend.store.metadata.findByKeyId("revoke");
    assert.strictEqual(
      revoked.success && revoked.value?.revokedAt !== null,
      true,
    );
    assert.strictEqual(revoked.success && revoked.value?.revokedBy, "admin");
  });

  it("20 concurrent stores for one user and provider get 20 distinct write_seq values", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        backend.store.metadata.store(fixture({ keyId: `key-${i}` })),
      ),
    );
    for (const r of results) {
      assert.strictEqual(r.success, true);
    }
    const rows = await backend.db.all<{ key_id: string; write_seq: number }>(
      "SELECT key_id, write_seq FROM byok_key_metadata WHERE user_id = ? AND provider = ?",
      ["user-1", "openai"],
    );
    assert.strictEqual(rows.length, 20);
    const seqs = rows.map((r) => r.write_seq);
    const uniq = new Set(seqs);
    assert.strictEqual(uniq.size, 20);
  });

  it("write_seq increases across sequential stores", async () => {
    const first = await backend.store.metadata.store(
      fixture({ keyId: "seq-a" }),
    );
    assert.strictEqual(first.success, true);
    const before = await backend.db.get<{ write_seq: number }>(
      "SELECT write_seq FROM byok_key_metadata WHERE key_id = ?",
      ["seq-a"],
    );

    const second = await backend.store.metadata.store(
      fixture({ keyId: "seq-b" }),
    );
    assert.strictEqual(second.success, true);
    const after = await backend.db.get<{ write_seq: number }>(
      "SELECT write_seq FROM byok_key_metadata WHERE key_id = ?",
      ["seq-b"],
    );
    assert.strictEqual(after!.write_seq > before!.write_seq, true);
  });

  it("createdAt and revokedAt round-trip as ISO strings", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    await backend.store.metadata.store(fixture({ keyId: "time-1", createdAt }));
    await backend.store.metadata.markRevoked("time-1", "admin");
    await backend.store.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "time-1",
      revokedAt: "2026-02-02T00:00:00.000Z",
      revokedBy: "admin",
    });

    const meta = await backend.store.metadata.findByKeyId("time-1");
    assert.strictEqual(meta.success && meta.value?.createdAt, createdAt);
    assert.strictEqual(meta.success && typeof meta.value?.revokedAt, "string");
    assert.strictEqual(meta.success && typeof meta.value?.revokedBy, "string");
    new Date(
      meta.success && meta.value?.revokedAt
        ? (meta.value!.revokedAt as string)
        : "",
    ).getTime();

    const raw = await backend.db.get<{ revoked_at: string }>(
      "SELECT revoked_at FROM byok_revocations WHERE user_id = ? AND provider = ?",
      ["user-1", "openai"],
    );
    assert.strictEqual(typeof raw!.revoked_at, "string");
    new Date(raw!.revoked_at).getTime();
  });

  it("the store runs on any PlatformDb: store, find, revoke", async () => {
    assert.strictEqual(
      (await backend.store.metadata.store(fixture({ keyId: "k1" }))).success,
      true,
    );

    const found = await backend.store.metadata.findByKeyId("k1");
    assert.strictEqual(found.success && found.value?.keyId, "k1");

    const userFound = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(userFound.success && userFound.value?.keyId, "k1");

    assert.strictEqual(
      (await backend.store.metadata.markRevoked("k1", "admin")).success,
      true,
    );
  });

  it("write_seq still orders by last write: store A, store B, re-store A", async () => {
    await backend.store.metadata.store(fixture({ keyId: "A" }));
    await backend.store.metadata.store(fixture({ keyId: "B" }));
    await backend.store.metadata.store(fixture({ keyId: "A", keyVersion: 2 }));

    const r = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.strictEqual(r.success && r.value?.keyId, "A");
  });

  it("two stores started together both land and one is current", async () => {
    const [rA, rB] = await Promise.all([
      backend.store.metadata.store(fixture({ keyId: "kA" })),
      backend.store.metadata.store(fixture({ keyId: "kB" })),
    ]);
    assert.strictEqual(rA.success, true);
    assert.strictEqual(rB.success, true);

    // Both rows exist.
    const a = await backend.store.metadata.findByKeyId("kA");
    const b = await backend.store.metadata.findByKeyId("kB");
    assert.strictEqual(a.success && a.value?.keyId, "kA");
    assert.strictEqual(b.success && b.value?.keyId, "kB");

    // findByUserAndProvider returns one of them (last write wins).
    const current = await backend.store.metadata.findByUserAndProvider(
      "user-1",
      "openai",
    );
    assert.ok(current.success && current.value !== null);
    assert.ok(
      current.value?.keyId === "kA" || current.value?.keyId === "kB",
      `expected kA or kB, got ${current.value?.keyId}`,
    );

    // On Postgres: write_seq values are distinct, and the current key has
    // the greater write_seq (the one nextval handed it last).
    if (backend.kind === "postgres") {
      const rows = await backend.db.all<{ key_id: string; write_seq: number }>(
        "SELECT key_id, write_seq FROM byok_key_metadata WHERE user_id = ? AND provider = ?",
        ["user-1", "openai"],
      );
      assert.strictEqual(rows.length, 2);
      const seqMap = new Map(rows.map((r) => [r.key_id, r.write_seq]));
      const aSeq = seqMap.get("kA")!;
      const bSeq = seqMap.get("kB")!;
      assert.notStrictEqual(aSeq, bSeq);
      const expected = aSeq > bSeq ? "kA" : "kB";
      assert.strictEqual(current.value?.keyId, expected);
    }
  });

  it("close returns a Promise and a second close resolves", async () => {
    const firstClose = backend.store.close();
    assert.ok(firstClose instanceof Promise);
    await firstClose;

    // A second close resolves without throwing.
    await backend.store.close();
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

  it("Pg: keeps metadata + revocation after the pool is closed and reopened", async () => {
    const { db, url, drop } = await createTestPgDb({ max: 2 });
    const store1 = createByokStoreOn(db);
    await store1.metadata.store(fixture());
    await store1.metadata.markRevoked("key-1", "admin");
    await store1.revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "key-1",
      revokedAt: "2026-01-02T00:00:00.000Z",
      revokedBy: "admin",
    });
    await store1.close();

    // A fresh pool on the same database — as a container restart looks like.
    const pool = createPgPool(url, { max: 2 });
    const db2 = createPgPlatformDb(pool);
    const store2 = createByokStoreOn(db2);

    const meta = await store2.metadata.findByKeyId("key-1");
    assert.strictEqual(meta.success && meta.value?.revokedAt !== null, true);
    assert.strictEqual(meta.success && meta.value?.revokedBy, "admin");

    const revoked = await store2.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(revoked.success && revoked.value, true);
    await store2.close();
    await drop();
  });
});
