import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../../domain/errors/byok-error.vo.js";
import type { KeyMetadata } from "../../../domain/entities/key-metadata.entity.js";
import type { ByokProvider } from "../../../domain/value-objects/provider.vo.js";

export interface KeyMetadataStorePort {
  store(metadata: KeyMetadata): Promise<Result<void, ByokError>>;
  findByUserAndProvider(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<KeyMetadata | null, ByokError>>;
  findByKeyId(keyId: string): Promise<Result<KeyMetadata | null, ByokError>>;
  markRevoked(
    keyId: string,
    revokedBy: string,
  ): Promise<Result<void, ByokError>>;
  hasKeys(userId: string): Promise<Result<boolean, ByokError>>;
}
