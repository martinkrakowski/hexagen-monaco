import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type {
  ServerEncryptionPort,
  EncryptInput,
  EncryptOutput,
  DecryptInput,
  DecryptOutput,
} from "../../src/application/ports/out/server-encryption-port.port.js";

const FIXED_CIPHERTEXT_PREFIX = "v1:";
const STUB_ENCRYPTED = "STUB_ENCRYPTED";
const FIXED_KEY_ID = "stub-key-id-00000000-0000-0000-0000-000000000001";
const DECRYPTED_RAW_KEY = "sk-test-decrypted-key-12345678901234567890";

export class StubEncryptionAdapter implements ServerEncryptionPort {
  private activeVersion: number;
  private shouldEncryptFail: boolean;
  private encryptCallCount: number;

  constructor(options?: {
    activeVersion?: number;
    shouldEncryptFail?: boolean;
  }) {
    this.activeVersion = options?.activeVersion ?? 1;
    this.shouldEncryptFail = options?.shouldEncryptFail ?? false;
    this.encryptCallCount = 0;
  }

  async encrypt(
    input: EncryptInput,
  ): Promise<Result<EncryptOutput, ByokError>> {
    this.encryptCallCount++;
    if (this.shouldEncryptFail) {
      return {
        success: false,
        error: {
          kind: "encryption_failed",
          message: "Stub encryption failure",
        },
      };
    }
    return {
      success: true,
      value: {
        ciphertext: `v${input.version}:${STUB_ENCRYPTED}`,
        keyId: FIXED_KEY_ID,
        version: input.version,
      },
    };
  }

  async decrypt(
    input: DecryptInput,
  ): Promise<Result<DecryptOutput, ByokError>> {
    if (input.ciphertext.startsWith(FIXED_CIPHERTEXT_PREFIX)) {
      return {
        success: true,
        value: { rawKey: DECRYPTED_RAW_KEY, version: 1 },
      };
    }
    return {
      success: false,
      error: {
        kind: "invalid_ciphertext",
        message: "Stub decrypt failure: missing version prefix",
      },
    };
  }

  getActiveKeyVersion(): number {
    return this.activeVersion;
  }

  getEncryptCallCount(): number {
    return this.encryptCallCount;
  }
}
