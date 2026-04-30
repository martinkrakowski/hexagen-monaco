import type {
  Result,
  ByokError,
  KeyMetadata,
  ByokProvider,
} from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import type { KeyMetadataStorePort } from "../../application/ports/out/key-metadata-store-port.port.js";

export class InMemoryKeyMetadataAdapter implements KeyMetadataStorePort {
  private readonly byKeyId = new Map<string, KeyMetadata>();
  private readonly byUserProvider = new Map<string, KeyMetadata>();

  private userProviderKey(userId: string, provider: ByokProvider): string {
    return `${userId}:${provider}`;
  }

  async store(metadata: KeyMetadata): Promise<Result<void, ByokError>> {
    try {
      this.byKeyId.set(metadata.keyId, metadata);
      this.byUserProvider.set(
        this.userProviderKey(metadata.userId, metadata.provider),
        metadata,
      );
      return ok(undefined) as Result<void, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to store key metadata",
      } satisfies ByokError);
    }
  }

  async findByUserAndProvider(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<KeyMetadata | null, ByokError>> {
    try {
      const metadata =
        this.byUserProvider.get(this.userProviderKey(userId, provider)) ?? null;
      return ok(metadata) as Result<KeyMetadata | null, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to find key metadata by user and provider",
      } satisfies ByokError);
    }
  }

  async findByKeyId(
    keyId: string,
  ): Promise<Result<KeyMetadata | null, ByokError>> {
    try {
      const metadata = this.byKeyId.get(keyId) ?? null;
      return ok(metadata) as Result<KeyMetadata | null, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to find key metadata by key ID",
      } satisfies ByokError);
    }
  }

  async markRevoked(
    keyId: string,
    revokedBy: string,
  ): Promise<Result<void, ByokError>> {
    try {
      const existing = this.byKeyId.get(keyId);
      if (!existing) {
        return err({
          kind: "key_not_found",
          message: `Key metadata not found for keyId: ${keyId}`,
          provider: "unknown",
        } satisfies ByokError);
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
      return ok(undefined) as Result<void, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to mark key as revoked",
      } satisfies ByokError);
    }
  }
}
