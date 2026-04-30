import type { Result, ByokError, ByokProvider } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import type {
  RevocationStorePort,
  RevocationEntry,
} from "../../application/ports/out/revocation-store-port.port.js";

export class InMemoryRevocationAdapter implements RevocationStorePort {
  private readonly revokedSet = new Set<string>();
  private readonly entries = new Map<string, RevocationEntry>();

  private revocationKey(userId: string, provider: ByokProvider): string {
    return `${userId}:${provider}`;
  }

  async revoke(entry: RevocationEntry): Promise<Result<void, ByokError>> {
    try {
      const key = this.revocationKey(entry.userId, entry.provider);
      this.revokedSet.add(key);
      this.entries.set(key, entry);
      return ok(undefined) as Result<void, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to record revocation",
      } satisfies ByokError);
    }
  }

  async isRevoked(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<boolean, ByokError>> {
    try {
      return ok(
        this.revokedSet.has(this.revocationKey(userId, provider)),
      ) as Result<boolean, ByokError>;
    } catch (error) {
      return err({
        kind: "metadata_store_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to check revocation status",
      } satisfies ByokError);
    }
  }
}
