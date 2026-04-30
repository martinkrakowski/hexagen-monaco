import type { ByokProvider } from "../value-objects/provider.vo.js";

export interface KeyMetadata {
  readonly keyId: string;
  readonly userId: string;
  readonly provider: ByokProvider;
  readonly keyVersion: number;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
}
