import type {
  Result,
  ByokError,
  CiphertextEnvelope,
} from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import { constructAAD, validateApiKeyFormat } from "../../domain/index.js";
import type {
  EncryptKeyPort,
  EncryptKeyInput,
} from "../ports/in/encrypt-key-port.port.js";
import type { ServerEncryptionPort } from "../ports/out/server-encryption-port.port.js";
import type { KeyMetadataStorePort } from "../ports/out/key-metadata-store-port.port.js";
import type { AuditLogPort } from "../ports/out/audit-log-port.port.js";

export class EncryptApiKeyUseCase implements EncryptKeyPort {
  constructor(
    private readonly encryption: ServerEncryptionPort,
    private readonly metadataStore: KeyMetadataStorePort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(
    input: EncryptKeyInput,
  ): Promise<Result<CiphertextEnvelope, ByokError>> {
    const formatResult = validateApiKeyFormat(input.apiKey, input.provider);
    if (!formatResult.success) {
      return err(formatResult.error);
    }

    const aad = constructAAD(input.userId);

    const encryptResult = await this.encryption.encrypt({
      rawKey: input.apiKey,
      aad,
      version: this.encryption.getActiveKeyVersion(),
      provider: input.provider,
    });

    if (!encryptResult.success) {
      return encryptResult;
    }

    const output = encryptResult.value;

    const storeResult = await this.metadataStore.store({
      keyId: output.keyId,
      userId: input.userId,
      provider: input.provider,
      keyVersion: output.version,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokedBy: null,
    });

    if (!storeResult.success) {
      return storeResult;
    }

    await this.auditLog.record({
      eventType: "byok.key_stored",
      userId: input.userId,
      provider: input.provider,
      keyId: output.keyId,
      timestamp: new Date().toISOString(),
      details: { keyVersion: output.version },
    });

    return ok({
      ciphertext: output.ciphertext,
      provider: input.provider,
      keyId: output.keyId,
      createdAt: new Date().toISOString(),
    } satisfies CiphertextEnvelope) as Result<CiphertextEnvelope, ByokError>;
  }
}
