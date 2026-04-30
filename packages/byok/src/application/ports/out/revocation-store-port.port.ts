import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../../domain/errors/byok-error.vo.js";
import type { ByokProvider } from "../../../domain/value-objects/provider.vo.js";

export interface RevocationEntry {
  userId: string;
  provider: ByokProvider;
  keyId: string;
  revokedAt: string;
  revokedBy: string;
}

export interface RevocationStorePort {
  revoke(entry: RevocationEntry): Promise<Result<void, ByokError>>;
  isRevoked(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<boolean, ByokError>>;
}
