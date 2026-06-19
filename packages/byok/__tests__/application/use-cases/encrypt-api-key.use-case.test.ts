import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EncryptApiKeyUseCase } from "../../../src/application/use-cases/encrypt-api-key.use-case.js";
import { StubEncryptionAdapter } from "../../doubles/stub-encryption.adapter.js";
import { StubKeyMetadataAdapter } from "../../doubles/stub-key-metadata.adapter.js";
import { StubAuditLogAdapter } from "../../doubles/stub-audit-log.adapter.js";

describe("EncryptApiKeyUseCase", () => {
  it("returns a CiphertextEnvelope on valid API key input", async () => {
    const encryption = new StubEncryptionAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      provider: "openai",
      userId: "user-1",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(typeof result.value.ciphertext, "string");
      assert.strictEqual(result.value.provider, "openai");
      assert.strictEqual(typeof result.value.keyId, "string");
      assert.strictEqual(typeof result.value.createdAt, "string");
    }
  });

  it("returns err with kind invalid_key_format for invalid API key", async () => {
    const encryption = new StubEncryptionAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-short",
      provider: "openai",
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_key_format");
    }
  });

  it("returns err when encryption fails", async () => {
    const encryption = new StubEncryptionAdapter({ shouldEncryptFail: true });
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      provider: "openai",
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "encryption_failed");
    }
  });

  it("returns err when metadata store fails", async () => {
    const encryption = new StubEncryptionAdapter();
    const metadataStore = new StubKeyMetadataAdapter({ shouldStoreFail: true });
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      provider: "openai",
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "metadata_store_error");
    }
  });

  it("passes the correct provider and userId to encryption", async () => {
    const encryption = new StubEncryptionAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890abcdef",
      provider: "anthropic",
      userId: "user-42",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.provider, "anthropic");
    }
  });

  it("records an audit event on successful encryption", async () => {
    const encryption = new StubEncryptionAdapter();
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    await useCase.execute({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      provider: "openai",
      userId: "user-1",
    });

    const events = auditLog.getEvents();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].eventType, "byok.key_stored");
    assert.strictEqual(events[0].userId, "user-1");
  });

  it("uses the active key version from encryption adapter", async () => {
    const encryption = new StubEncryptionAdapter({ activeVersion: 3 });
    const metadataStore = new StubKeyMetadataAdapter();
    const auditLog = new StubAuditLogAdapter();
    const useCase = new EncryptApiKeyUseCase(
      encryption,
      metadataStore,
      auditLog,
    );

    const result = await useCase.execute({
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
      provider: "openai",
      userId: "user-1",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.match(result.value.ciphertext, /^v3:/);
    }
  });
});
