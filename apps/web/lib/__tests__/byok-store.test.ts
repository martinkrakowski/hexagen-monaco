import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyMetadata } from "@hexagen/byok";
import { createByokStore } from "../byok-store";

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
    store.close();
  });

  it("findByUserAndProvider returns the most recently stored key (last-write-wins)", async () => {
    const store = createByokStore(":memory:");
    await store.metadata.store(fixture({ keyId: "old" }));
    await store.metadata.store(fixture({ keyId: "new" }));
    const r = await store.metadata.findByUserAndProvider("user-1", "openai");
    assert.strictEqual(r.success && r.value?.keyId, "new");
    store.close();
  });

  it("markRevoked on a missing key returns key_not_found", async () => {
    const store = createByokStore(":memory:");
    const r = await store.metadata.markRevoked("nope", "admin");
    assert.strictEqual(r.success, false);
    if (!r.success) {
      assert.strictEqual(r.error.kind, "key_not_found");
    }
    store.close();
  });

  it("hasKeys stays true even after the user's only key is revoked", async () => {
    const store = createByokStore(":memory:");
    await store.metadata.store(fixture());
    await store.metadata.markRevoked("key-1", "admin");
    const r = await store.metadata.hasKeys("user-1");
    assert.strictEqual(r.success && r.value, true);
    store.close();
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
    store.close();
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
    first.close();

    // A fresh handle on the same file is what a container restart looks like.
    const second = createByokStore(dbPath);
    const meta = await second.metadata.findByKeyId("key-1");
    assert.strictEqual(meta.success && meta.value?.revokedAt !== null, true);
    assert.strictEqual(meta.success && meta.value?.revokedBy, "admin");

    const revoked = await second.revocation.isRevoked("user-1", "openai");
    assert.strictEqual(revoked.success && revoked.value, true);
    second.close();
  });
});
