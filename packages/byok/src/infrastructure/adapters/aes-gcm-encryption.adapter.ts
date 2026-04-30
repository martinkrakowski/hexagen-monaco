import crypto from "node:crypto";
import type { Result, ByokError } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import { aadToBuffer } from "../../domain/index.js";
import type {
  ServerEncryptionPort,
  EncryptInput,
  EncryptOutput,
  DecryptInput,
  DecryptOutput,
} from "../../application/ports/out/server-encryption-port.port.js";

function getActiveKeyVersion(): number {
  const envVal = process.env.ACTIVE_KEY_VERSION;
  if (envVal) {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 1;
}

function deriveKey(version: number): Buffer {
  const secret = process.env.SERVER_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("SERVER_ENCRYPTION_SECRET environment variable is not set");
  }
  const info = Buffer.from(`byok-v${version}`, "utf-8");
  const salt = Buffer.from("byok-enc", "utf-8");
  return Buffer.from(crypto.hkdfSync("sha256", secret, salt, info, 32));
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

export class AesGcmEncryptionAdapter implements ServerEncryptionPort {
  async encrypt(
    input: EncryptInput,
  ): Promise<Result<EncryptOutput, ByokError>> {
    try {
      const iv = crypto.randomBytes(12);
      const key = deriveKey(input.version);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      cipher.setAAD(aadToBuffer(input.aad));
      const encrypted = Buffer.concat([
        cipher.update(input.rawKey, "utf-8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const blob = Buffer.concat([iv, authTag, encrypted]);
      const ciphertext = `v${input.version}:${toBase64Url(blob)}`;
      const keyId = crypto.randomUUID();
      return ok({
        ciphertext,
        keyId,
        version: input.version,
      } satisfies EncryptOutput) as Result<EncryptOutput, ByokError>;
    } catch (error) {
      return err({
        kind: "encryption_failed",
        message: error instanceof Error ? error.message : "Encryption failed",
      } satisfies ByokError);
    }
  }

  async decrypt(
    input: DecryptInput,
  ): Promise<Result<DecryptOutput, ByokError>> {
    try {
      const prefixMatch = input.ciphertext.match(/^v(\d+):/);
      if (!prefixMatch) {
        return err({
          kind: "invalid_ciphertext",
          message: "Missing version prefix in ciphertext",
        } satisfies ByokError);
      }
      const version = Number(prefixMatch[1]);
      const base64Part = input.ciphertext.slice(prefixMatch[0].length);
      const blob = fromBase64Url(base64Part);
      if (blob.length < 28) {
        return err({
          kind: "invalid_ciphertext",
          message: "Ciphertext blob too short",
        } satisfies ByokError);
      }
      const iv = blob.subarray(0, 12);
      const authTag = blob.subarray(12, 28);
      const encPayload = blob.subarray(28);
      const key = deriveKey(version);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAuthTag(authTag);
      decipher.setAAD(aadToBuffer(input.aad));
      const rawKey =
        decipher.update(encPayload, undefined, "utf-8") +
        decipher.final("utf-8");
      return ok({
        rawKey,
        version,
      } satisfies DecryptOutput) as Result<DecryptOutput, ByokError>;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Decryption failed";
      if (
        message.includes("Unsupported state") ||
        message.includes("auth tag")
      ) {
        return err({
          kind: "decryption_failed",
          message,
          reason: "tag_failure",
        } satisfies ByokError);
      }
      return err({
        kind: "decryption_failed",
        message,
        reason: "tag_failure",
      } satisfies ByokError);
    }
  }

  getActiveKeyVersion(): number {
    return getActiveKeyVersion();
  }
}
