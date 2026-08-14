import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyMetadata } from "@hexagen/byok";
import { getMetadataAdapter, clearByokCache } from "../byok-wire";

const KEY: KeyMetadata = {
  keyId: "wire-key-1",
  userId: "wire-user-1",
  provider: "openai",
  keyVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
};

describe("byok-wire durability (AUD-007)", () => {
  let dir = "";
  let prev: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "byok-wire-"));
    prev = process.env.BYOK_DB_PATH;
    process.env.BYOK_DB_PATH = join(dir, "byok.db");
    clearByokCache();
  });

  afterAll(() => {
    clearByokCache();
    if (prev === undefined) delete process.env.BYOK_DB_PATH;
    else process.env.BYOK_DB_PATH = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a key's revocation across a simulated container restart", async () => {
    // Store a key and revoke it through the wired metadata adapter.
    const before = getMetadataAdapter();
    assert.strictEqual((await before.store(KEY)).success, true);
    assert.strictEqual(
      (await before.markRevoked(KEY.keyId, "admin")).success,
      true,
    );

    // Simulate a restart: drop every cached singleton (and, with the durable
    // store, close the SQLite handle) so the next lookup reopens from disk.
    clearByokCache();

    const after = getMetadataAdapter();
    const found = await after.findByKeyId(KEY.keyId);
    // In-memory adapter: the fresh instance is empty ⇒ null ⇒ this fails (RED).
    // Durable store: the revocation was persisted to disk ⇒ still present (GREEN).
    assert.strictEqual(found.success, true);
    assert.ok(
      found.success && found.value !== null,
      "key metadata lost after restart",
    );
    assert.ok(
      found.success && found.value?.revokedAt !== null,
      "revocation lost after restart",
    );
    assert.strictEqual(found.success && found.value?.revokedBy, "admin");
  });
});
