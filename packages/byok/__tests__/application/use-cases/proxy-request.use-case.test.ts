import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ProxyRequestUseCase } from "../../../src/application/use-cases/proxy-request.use-case.js";
import { StubEncryptionAdapter } from "../../doubles/stub-encryption.adapter.js";
import { StubRevocationAdapter } from "../../doubles/stub-revocation.adapter.js";
import { StubProviderProxyAdapter } from "../../doubles/stub-provider-proxy.adapter.js";
import { StubAuditLogAdapter } from "../../doubles/stub-audit-log.adapter.js";
import { StubKeyMetadataAdapter } from "../../doubles/stub-key-metadata.adapter.js";

async function setupProxyDeps(options?: {
  revocation?: StubRevocationAdapter;
  encryption?: StubEncryptionAdapter;
  providerProxy?: StubProviderProxyAdapter;
  auditLog?: StubAuditLogAdapter;
  metadataStore?: StubKeyMetadataAdapter;
}) {
  const encryption = options?.encryption ?? new StubEncryptionAdapter();
  const revocation = options?.revocation ?? new StubRevocationAdapter();
  const providerProxy =
    options?.providerProxy ?? new StubProviderProxyAdapter();
  const auditLog = options?.auditLog ?? new StubAuditLogAdapter();
  const metadataStore = options?.metadataStore ?? new StubKeyMetadataAdapter();

  const useCase = new ProxyRequestUseCase(
    encryption,
    revocation,
    providerProxy,
    auditLog,
    metadataStore,
  );

  return {
    useCase,
    encryption,
    revocation,
    providerProxy,
    auditLog,
    metadataStore,
  };
}

describe("ProxyRequestUseCase", () => {
  it("returns proxy response data on valid ciphertext and non-revoked key", async () => {
    const { useCase } = await setupProxyDeps();

    const result = await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: { model: "gpt-4", messages: [] },
      userId: "user-1",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.value.data);
      assert.strictEqual(
        (
          result.value.data.choices as Array<{ message: { content: string } }>
        )[0].message.content,
        "stub response",
      );
    }
  });

  it("returns err with kind key_revoked when key is revoked", async () => {
    const revocation = new StubRevocationAdapter();
    await revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "some-key",
      revokedAt: new Date().toISOString(),
      revokedBy: "admin",
    });

    const { useCase } = await setupProxyDeps({ revocation });

    const result = await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "key_revoked");
    }
  });

  it("returns err with kind invalid_ciphertext when decryption fails", async () => {
    const { useCase } = await setupProxyDeps();

    const result = await useCase.execute({
      ciphertext: "invalid-no-prefix",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "invalid_ciphertext");
    }
  });

  it("returns err when provider proxy fails", async () => {
    const providerProxy = new StubProviderProxyAdapter({ shouldFail: true });
    const { useCase } = await setupProxyDeps({ providerProxy });

    const result = await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.error.kind, "provider_error");
    }
  });

  it("sets rotatedCiphertext when decrypt version < active version", async () => {
    const encryption = new StubEncryptionAdapter({ activeVersion: 2 });
    const { useCase } = await setupProxyDeps({ encryption });

    const result = await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(typeof result.value.rotatedCiphertext, "string");
    }
  });

  it("does not set rotatedCiphertext when decrypt version === active version", async () => {
    const encryption = new StubEncryptionAdapter({ activeVersion: 1 });
    const { useCase } = await setupProxyDeps({ encryption });

    const result = await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.rotatedCiphertext, undefined);
    }
  });

  it("records audit event on revoked key access", async () => {
    const revocation = new StubRevocationAdapter();
    const auditLog = new StubAuditLogAdapter();
    await revocation.revoke({
      userId: "user-1",
      provider: "openai",
      keyId: "some-key",
      revokedAt: new Date().toISOString(),
      revokedBy: "admin",
    });

    const { useCase } = await setupProxyDeps({ revocation, auditLog });

    await useCase.execute({
      ciphertext: "v1:some-ciphertext",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    const events = auditLog.getEvents();
    assert.ok(events.some((e) => e.eventType === "byok.key_revoked"));
  });

  it("records audit event on decryption failure", async () => {
    const auditLog = new StubAuditLogAdapter();
    const { useCase } = await setupProxyDeps({ auditLog });

    await useCase.execute({
      ciphertext: "invalid-no-prefix",
      provider: "openai",
      payload: {},
      userId: "user-1",
    });

    const events = auditLog.getEvents();
    assert.ok(events.some((e) => e.eventType === "byok.decrypt_failure"));
  });

  describe("streamExecute", () => {
    it("returns ReadableStream on valid ciphertext and non-revoked key", async () => {
      const { useCase } = await setupProxyDeps();

      const result = await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: { model: "gpt-4", messages: [], stream: true },
        userId: "user-1",
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.value.stream instanceof ReadableStream);
        const reader = result.value.stream.getReader();
        const { value } = await reader.read();
        assert.ok(value instanceof Uint8Array);
        reader.releaseLock();
      }
    });

    it("returns err with kind key_revoked when key is revoked", async () => {
      const revocation = new StubRevocationAdapter();
      await revocation.revoke({
        userId: "user-1",
        provider: "openai",
        keyId: "some-key",
        revokedAt: new Date().toISOString(),
        revokedBy: "admin",
      });

      const { useCase } = await setupProxyDeps({ revocation });

      const result = await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.kind, "key_revoked");
      }
    });

    it("returns err with kind invalid_ciphertext when decryption fails", async () => {
      const { useCase } = await setupProxyDeps();

      const result = await useCase.streamExecute({
        ciphertext: "invalid-no-prefix",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.kind, "invalid_ciphertext");
      }
    });

    it("returns err when provider stream proxy fails", async () => {
      const providerProxy = new StubProviderProxyAdapter({ shouldFail: true });
      const { useCase } = await setupProxyDeps({ providerProxy });

      const result = await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error.kind, "provider_error");
      }
    });

    it("sets rotatedCiphertext when decrypt version < active version", async () => {
      const encryption = new StubEncryptionAdapter({ activeVersion: 2 });
      const { useCase } = await setupProxyDeps({ encryption });

      const result = await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(typeof result.value.rotatedCiphertext, "string");
      }
    });

    it("does not set rotatedCiphertext when decrypt version === active version", async () => {
      const encryption = new StubEncryptionAdapter({ activeVersion: 1 });
      const { useCase } = await setupProxyDeps({ encryption });

      const result = await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value.rotatedCiphertext, undefined);
      }
    });

    it("records streaming audit event on success", async () => {
      const auditLog = new StubAuditLogAdapter();
      const { useCase } = await setupProxyDeps({ auditLog });

      await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      const events = auditLog.getEvents();
      assert.ok(
        events.some(
          (e) =>
            e.eventType === "byok.proxy_called" &&
            e.details?.streaming === true,
        ),
      );
    });

    it("records streaming audit event on provider failure", async () => {
      const providerProxy = new StubProviderProxyAdapter({ shouldFail: true });
      const auditLog = new StubAuditLogAdapter();
      const { useCase } = await setupProxyDeps({ providerProxy, auditLog });

      await useCase.streamExecute({
        ciphertext: "v1:some-ciphertext",
        provider: "openai",
        payload: {},
        userId: "user-1",
      });

      const events = auditLog.getEvents();
      assert.ok(
        events.some(
          (e) =>
            e.eventType === "byok.proxy_called" &&
            e.details?.failed === true &&
            e.details?.streaming === true,
        ),
      );
    });
  });
});
