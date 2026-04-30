import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../../domain/errors/byok-error.vo.js";
import type { AAD } from "../../../domain/value-objects/aad.vo.js";
import type { ByokProvider } from "../../../domain/value-objects/provider.vo.js";

export interface EncryptInput {
  rawKey: string;
  aad: AAD;
  version: number;
  provider: ByokProvider;
}

export interface EncryptOutput {
  ciphertext: string;
  keyId: string;
  version: number;
}

export interface DecryptInput {
  ciphertext: string;
  aad: AAD;
}

export interface DecryptOutput {
  rawKey: string;
  version: number;
}

export interface ServerEncryptionPort {
  encrypt(input: EncryptInput): Promise<Result<EncryptOutput, ByokError>>;
  decrypt(input: DecryptInput): Promise<Result<DecryptOutput, ByokError>>;
  getActiveKeyVersion(): number;
}
