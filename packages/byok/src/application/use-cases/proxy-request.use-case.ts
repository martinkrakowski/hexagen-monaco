import type { Result, ByokError } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import { constructAAD } from "../../domain/index.js";
import type {
  ProxyRequestPort,
  ProxyRequestInput,
  ProxyRequestOutput,
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

  async execute(
    input: ProxyRequestInput,
  ): Promise<Result<ProxyRequestOutput, ByokError>> {
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

    const proxyResult = await this.providerProxy.proxy({
      rawKey: decryptResult.value.rawKey,
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

    let rotatedCiphertext: string | undefined;

    if (decryptResult.value.version < this.encryption.getActiveKeyVersion()) {
      const rotateResult = await this.encryption.encrypt({
        rawKey: decryptResult.value.rawKey,
        aad,
        version: this.encryption.getActiveKeyVersion(),
        provider: input.provider,
      });

      if (rotateResult.success) {
        rotatedCiphertext = rotateResult.value.ciphertext;
        await this.auditLog.record({
          eventType: "byok.key_rotated",
          userId: input.userId,
          provider: input.provider,
          timestamp: new Date().toISOString(),
          details: { newVersion: rotateResult.value.version },
        });
      }
    }

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
}
