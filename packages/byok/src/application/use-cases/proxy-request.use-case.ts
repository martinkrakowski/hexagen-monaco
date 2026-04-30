import type { Result, ByokError } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import { constructAAD } from "../../domain/index.js";
import type {
  ProxyRequestPort,
  ProxyRequestInput,
  ProxyRequestOutput,
  ProxyStreamResult,
} from "../ports/in/proxy-request-port.port.js";
import type { ServerEncryptionPort } from "../ports/out/server-encryption-port.port.js";
import type { RevocationStorePort } from "../ports/out/revocation-store-port.port.js";
import type { ProviderProxyPort } from "../ports/out/provider-proxy-port.port.js";
import type { AuditLogPort } from "../ports/out/audit-log-port.port.js";
import type { KeyMetadataStorePort } from "../ports/out/key-metadata-store-port.port.js";

export class ProxyRequestUseCase implements ProxyRequestPort {
  constructor(
    private readonly encryption: ServerEncryptionPort,
    private readonly revocationStore: RevocationStorePort,
    private readonly providerProxy: ProviderProxyPort,
    private readonly auditLog: AuditLogPort,
    private readonly metadataStore: KeyMetadataStorePort,
  ) {}

  private async checkRevocation(
    input: ProxyRequestInput,
  ): Promise<Result<true, ByokError>> {
    const revocationResult = await this.revocationStore.isRevoked(
      input.userId,
      input.provider,
    );
    if (!revocationResult.success) {
      return revocationResult;
    }
    if (revocationResult.value) {
      await this.auditLog.record({
        eventType: "byok.key_revoked",
        userId: input.userId,
        provider: input.provider,
        timestamp: new Date().toISOString(),
        details: {},
      });
      return err({
        kind: "key_revoked",
        message: "Key has been revoked",
        provider: input.provider,
      });
    }
    return ok(true) as Result<true, ByokError>;
  }

  private async decryptKey(
    input: ProxyRequestInput,
  ): Promise<Result<{ rawKey: string; version: number }, ByokError>> {
    const aad = constructAAD(input.userId);
    const decryptResult = await this.encryption.decrypt({
      ciphertext: input.ciphertext,
      aad,
    });

    if (!decryptResult.success) {
      await this.auditLog.record({
        eventType: "byok.decrypt_failure",
        userId: input.userId,
        provider: input.provider,
        timestamp: new Date().toISOString(),
        details: { reason: "decrypt_failed" },
      });
      return err({ kind: "invalid_ciphertext", message: "Decryption failed" });
    }
    return ok({
      rawKey: decryptResult.value.rawKey,
      version: decryptResult.value.version,
    }) as Result<{ rawKey: string; version: number }, ByokError>;
  }

  private async rotateIfNeeded(
    rawKey: string,
    currentVersion: number,
    input: ProxyRequestInput,
  ): Promise<string | undefined> {
    if (currentVersion >= this.encryption.getActiveKeyVersion()) {
      return undefined;
    }
    const aad = constructAAD(input.userId);
    const rotateResult = await this.encryption.encrypt({
      rawKey,
      aad,
      version: this.encryption.getActiveKeyVersion(),
      provider: input.provider,
    });

    if (rotateResult.success) {
      await this.auditLog.record({
        eventType: "byok.key_rotated",
        userId: input.userId,
        provider: input.provider,
        timestamp: new Date().toISOString(),
        details: { newVersion: rotateResult.value.version },
      });
      return rotateResult.value.ciphertext;
    }
    return undefined;
  }

  async execute(
    input: ProxyRequestInput,
  ): Promise<Result<ProxyRequestOutput, ByokError>> {
    const revCheck = await this.checkRevocation(input);
    if (!revCheck.success) return revCheck;

    const decryptCheck = await this.decryptKey(input);
    if (!decryptCheck.success) return decryptCheck;

    const { rawKey, version } = decryptCheck.value;

    const proxyResult = await this.providerProxy.proxy({
      rawKey,
      provider: input.provider,
      payload: input.payload,
    });

    if (!proxyResult.success) {
      await this.auditLog.record({
        eventType: "byok.proxy_called",
        userId: input.userId,
        provider: input.provider,
        timestamp: new Date().toISOString(),
        details: { failed: true },
      });
      return proxyResult;
    }

    const rotatedCiphertext = await this.rotateIfNeeded(rawKey, version, input);

    await this.auditLog.record({
      eventType: "byok.proxy_called",
      userId: input.userId,
      provider: input.provider,
      timestamp: new Date().toISOString(),
      details: { statusCode: proxyResult.value.statusCode },
    });

    return ok({
      data: proxyResult.value.data,
      rotatedCiphertext,
    } satisfies ProxyRequestOutput) as Result<ProxyRequestOutput, ByokError>;
  }

  async streamExecute(
    input: ProxyRequestInput,
  ): Promise<Result<ProxyStreamResult, ByokError>> {
    const revCheck = await this.checkRevocation(input);
    if (!revCheck.success) return revCheck;

    const decryptCheck = await this.decryptKey(input);
    if (!decryptCheck.success) return decryptCheck;

    const { rawKey, version } = decryptCheck.value;

    const streamResult = await this.providerProxy.streamProxy({
      rawKey,
      provider: input.provider,
      payload: input.payload,
    });

    if (!streamResult.success) {
      await this.auditLog.record({
        eventType: "byok.proxy_called",
        userId: input.userId,
        provider: input.provider,
        timestamp: new Date().toISOString(),
        details: { failed: true, streaming: true },
      });
      return streamResult;
    }

    const rotatedCiphertext = await this.rotateIfNeeded(rawKey, version, input);

    await this.auditLog.record({
      eventType: "byok.proxy_called",
      userId: input.userId,
      provider: input.provider,
      timestamp: new Date().toISOString(),
      details: { streaming: true },
    });

    return ok({
      stream: streamResult.value,
      rotatedCiphertext,
    } satisfies ProxyStreamResult) as Result<ProxyStreamResult, ByokError>;
  }
}
