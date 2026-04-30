import type { ByokProvider } from "../value-objects/provider.vo.js";
import type { AAD } from "../value-objects/aad.vo.js";

export interface EncryptedKey {
  readonly ciphertext: string;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
  readonly version: number;
  readonly provider: ByokProvider;
  readonly keyId: string;
  readonly aad: AAD;
  readonly createdAt: string;
}
