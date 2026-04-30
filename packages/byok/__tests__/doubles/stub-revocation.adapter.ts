import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type { ByokProvider } from "../../src/domain/value-objects/provider.vo.js";
import type {
  RevocationStorePort,
  RevocationEntry,
} from "../../src/application/ports/out/revocation-store-port.port.js";

export class StubRevocationAdapter implements RevocationStorePort {
  private readonly revokedSet = new Set<string>();
  private shouldRevokeFail: boolean;

  constructor(options?: { shouldRevokeFail?: boolean }) {
    this.shouldRevokeFail = options?.shouldRevokeFail ?? false;
  }

  private revocationKey(userId: string, provider: ByokProvider): string {
    return `${userId}:${provider}`;
  }

  async revoke(entry: RevocationEntry): Promise<Result<void, ByokError>> {
    if (this.shouldRevokeFail) {
      return {
        success: false,
        error: {
          kind: "metadata_store_error",
          message: "Stub revocation failure",
        },
      };
    }
    this.revokedSet.add(this.revocationKey(entry.userId, entry.provider));
    return { success: true, value: undefined };
  }

  async isRevoked(
    userId: string,
    provider: ByokProvider,
  ): Promise<Result<boolean, ByokError>> {
    return {
      success: true,
      value: this.revokedSet.has(this.revocationKey(userId, provider)),
    };
  }
}
