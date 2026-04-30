import type { ByokProvider } from "./provider.vo.js";

export interface CiphertextEnvelope {
  readonly ciphertext: string;
  readonly provider: ByokProvider;
  readonly keyId: string;
  readonly createdAt: string;
}
