import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RevokeKeyUseCase } from "../../../src/application/use-cases/revoke-key.use-case.js";
import { StubRevocationAdapter } from "../../doubles/stub-revocation.adapter.js";
import { StubKeyMetadataAdapter } from "../../doubles/stub-key-metadata.adapter.js";
import { StubAuditLogAdapter } from "../../doubles/stub-audit-log.adapter.js";
import type { KeyMetadata } from "../../../src/domain/entities/key-metadata.entity.js";

describe("RevokeKeyUseCase", () => {
  it("revokes a key and returns ok when key exists", async () => {
    const revocation = new StubRevocationAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new RevokeKeyUseCase(revocation, metadataStore, auditLog);

    const metadata: KeyMetadata = {
      keyId: "key-001",
      userId: "user-1",
      provider: "openai",
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
    };
    await metadataStore.store(metadata);

    const result = await useCase.execute({
      userId: "user-1",
      provider: "openai",
      revokedBy: "admin",
    });

    assert.strictEqual(result.success, true);
  });

  it("returns err with kind key_not_found when key does not exist", async () => {
    const revocation = new StubRevocationAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new RevokeKeyUseCase(revocation, metadataStore, auditLog);

    const result = await useCase.execute({
      userId: "user-nonexistent",
      provider: "openai",
      revokedBy: "admin",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "key_not_found");
    }
  });

  it("returns err when revocation store fails", async () => {
    const revocation = new StubRevocationAdapter({ shouldRevokeFail: true });
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new RevokeKeyUseCase(revocation, metadataStore, auditLog);

    const metadata: KeyMetadata = {
      keyId: "key-002",
      userId: "user-2",
      provider: "anthropic",
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
    };
    await metadataStore.store(metadata);

    const result = await useCase.execute({
      userId: "user-2",
      provider: "anthropic",
      revokedBy: "admin",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "metadata_store_error");
    }
  });

  it("records an audit event on successful revocation", async () => {
    const revocation = new StubRevocationAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new RevokeKeyUseCase(revocation, metadataStore, auditLog);

    const metadata: KeyMetadata = {
      keyId: "key-003",
      userId: "user-3",
      provider: "cohere",
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
    };
    await metadataStore.store(metadata);

    await useCase.execute({
      userId: "user-3",
      provider: "cohere",
      revokedBy: "admin",
    });

    const events = auditLog.getEvents();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].eventType, "byok.key_revoked");
    assert.strictEqual(events[0].userId, "user-3");
  });

  it("marks the key metadata as revoked", async () => {
    const revocation = new StubRevocationAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new RevokeKeyUseCase(revocation, metadataStore, auditLog);

    const metadata: KeyMetadata = {
      keyId: "key-004",
      userId: "user-4",
      provider: "openai",
      keyVersion: 1,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
    };
    await metadataStore.store(metadata);

    await useCase.execute({
      userId: "user-4",
      provider: "openai",
      revokedBy: "self",
    });

    const findResult = await metadataStore.findByKeyId("key-004");
    assert.strictEqual(findResult.success, true);
    if (findResult.success && findResult.value) {
      assert.strictEqual(findResult.value.revokedBy, "self");
      assert.ok(findResult.value.revokedAt !== null);
    }
  });
});
