import type { Result, ByokError } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import type {
  RevokeKeyPort,
  RevokeKeyInput,
} from "../ports/in/revoke-key-port.port.js";
import type { RevocationStorePort } from "../ports/out/revocation-store-port.port.js";
import type { KeyMetadataStorePort } from "../ports/out/key-metadata-store-port.port.js";
import type { AuditLogPort } from "../ports/out/audit-log-port.port.js";

export class RevokeKeyUseCase implements RevokeKeyPort {
  constructor(
    private readonly revocationStore: RevocationStorePort,
    private readonly metadataStore: KeyMetadataStorePort,
    private readonly auditLog: AuditLogPort,
  ) {}

  async execute(input: RevokeKeyInput): Promise<Result<void, ByokError>> {
    const findResult = await this.metadataStore.findByUserAndProvider(
      input.userId,
      input.provider,
    );
    if (!findResult.success) {
      return findResult;
    }

    const metadata = findResult.value;
    if (!metadata) {
      return err({
        kind: "key_not_found",
        message: "No key found for this user and provider",
        provider: input.provider,
      });
    }

    const revokeResult = await this.revocationStore.revoke({
      userId: input.userId,
      provider: input.provider,
      keyId: metadata.keyId,
      revokedAt: new Date().toISOString(),
      revokedBy: input.revokedBy,
    });

    if (!revokeResult.success) {
      return revokeResult;
    }

    const markResult = await this.metadataStore.markRevoked(
      metadata.keyId,
      input.revokedBy,
    );
    if (!markResult.success) {
      return markResult;
    }

    await this.auditLog.record({
      eventType: "byok.key_revoked",
      userId: input.userId,
      provider: input.provider,
      keyId: metadata.keyId,
      timestamp: new Date().toISOString(),
      details: { revokedBy: input.revokedBy },
    });

    return ok(undefined) as Result<void, ByokError>;
  }
}
