import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type { KeyMetadata } from "../../src/domain/entities/key-metadata.entity.js";
import type { ByokProvider } from "../../src/domain/value-objects/provider.vo.js";
import type { KeyMetadataStorePort } from "../../src/application/ports/out/key-metadata-store-port.port.js";

export class StubKeyMetadataAdapter implements KeyMetadataStorePort {
  private readonly byKeyId = new Map<string, KeyMetadata>();
  private readonly byUserProvider = new Map<string, KeyMetadata>();
  private shouldStoreFail: boolean;

  constructor(options?: { shouldStoreFail?: boolean }) {
    this.shouldStoreFail = options?.shouldStoreFail ?? false;
  }

  private userProviderKey(userId: string, provider: ByokProvider): string {
    return `${userId}:${provider}`;
  }

  async store(metadata: KeyMetadata): Promise<Result<void, ByokError>> {
    if (this.shouldStoreFail) {
      return {
        success: false,
        error: {
          kind: "metadata_store_error",
          message: "Stub metadata store failure",
        },
      };
    }
    this.byKeyId.set(metadata.keyId, metadata);
    this.byUserProvider.set(
      this.userProviderKey(metadata.userId, metadata.provider),
      metadata,
    );
    return { success: true, value: undefined };
  }

  async findByUserAndProvider(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<KeyMetadata | null, ByokError>> {
    const metadata =
      this.byUserProvider.get(this.userProviderKey(userId, provider)) ?? null;
    return { success: true, value: metadata };
  }

  async findByKeyId(
    keyId: string,
  ): Promise<Result<KeyMetadata | null, ByokError>> {
    const metadata = this.byKeyId.get(keyId) ?? null;
    return { success: true, value: metadata };
  }

  async markRevoked(
    keyId: string,
    revokedBy: string,
  ): Promise<Result<void, ByokError>> {
    const existing = this.byKeyId.get(keyId);
    if (!existing) {
      return {
        success: false,
        error: {
          kind: "key_not_found",
          message: `Key metadata not found for keyId: ${keyId}`,
          provider: "unknown",
        },
      };
    }
    const updated: KeyMetadata = {
      ...existing,
      revokedAt: new Date().toISOString(),
      revokedBy,
    };
    this.byKeyId.set(keyId, updated);
    this.byUserProvider.set(
      this.userProviderKey(updated.userId, updated.provider),
      updated,
    );
    return { success: true, value: undefined };
  }

  // Mirrors InMemoryKeyMetadataAdapter.hasKeys: a prefix scan over the
  // user+provider index, revoked entries included (revocation marks the record,
  // it does not remove it).
  async hasKeys(userId: string): Promise<Result<boolean, ByokError>> {
    for (const key of this.byUserProvider.keys()) {
      if (key.startsWith(`${userId}:`)) {
        return { success: true, value: true };
      }
    }
    return { success: true, value: false };
  }
}
