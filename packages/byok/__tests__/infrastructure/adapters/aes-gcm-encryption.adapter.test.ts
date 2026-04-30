import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { AesGcmEncryptionAdapter } from "../../../src/infrastructure/adapters/aes-gcm-encryption.adapter.js";
import { constructAAD } from "../../../src/domain/value-objects/aad.vo.js";

const TEST_SECRET = "test-encryption-secret-must-be-32b!";

describe("AesGcmEncryptionAdapter", () => {
  let originalSecret: string | undefined;
  let originalVersion: string | undefined;

  before(() => {
    originalSecret = process.env.SERVER_ENCRYPTION_SECRET;
    originalVersion = process.env.ACTIVE_KEY_VERSION;
    process.env.SERVER_ENCRYPTION_SECRET = TEST_SECRET;
    delete process.env.ACTIVE_KEY_VERSION;
  });

  after(() => {
    if (originalSecret !== undefined) {
      process.env.SERVER_ENCRYPTION_SECRET = originalSecret;
    } else {
      delete process.env.SERVER_ENCRYPTION_SECRET;
    }
    if (originalVersion !== undefined) {
      process.env.ACTIVE_KEY_VERSION = originalVersion;
    } else {
      delete process.env.ACTIVE_KEY_VERSION;
    }
  });

  it("encrypt → decrypt round-trip returns the original key", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-round-trip");
    const rawKey = "sk-testroundtripkey12345678901234";

    const encryptResult = await adapter.encrypt({
      rawKey,
      aad,
      version: 1,
      provider: "openai",
    });

    assert.strictEqual(encryptResult.success, true);

    const decryptResult = await adapter.decrypt({
      ciphertext: encryptResult.success ? encryptResult.value.ciphertext : "",
      aad,
    });

    assert.strictEqual(decryptResult.success, true);
    if (decryptResult.success) {
      assert.strictEqual(decryptResult.value.rawKey, rawKey);
    }
  });

  it("returns err with tag_failure when decrypting with wrong AAD", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-original");
    const wrongAad = constructAAD("user-different");

    const encryptResult = await adapter.encrypt({
      rawKey: "sk-testaadkey12345678901234567890",
      aad,
      version: 1,
      provider: "openai",
    });

    assert.strictEqual(encryptResult.success, true);

    const decryptResult = await adapter.decrypt({
      ciphertext: encryptResult.success ? encryptResult.value.ciphertext : "",
      aad: wrongAad,
    });

    assert.strictEqual(decryptResult.success, false);
    if (!decryptResult.success) {
      assert.strictEqual(decryptResult.error.kind, "decryption_failed");
      assert.strictEqual(decryptResult.error.reason, "tag_failure");
    }
  });

  it("returns err when ciphertext is tampered (bit flip)", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-tamper");

    const encryptResult = await adapter.encrypt({
      rawKey: "sk-testtamperkey12345678901234567",
      aad,
      version: 1,
      provider: "openai",
    });

    assert.strictEqual(encryptResult.success, true);
    if (!encryptResult.success) return;

    const ciphertext = encryptResult.value.ciphertext;
    const prefixMatch = ciphertext.match(/^v(\d+):/);
    assert.ok(prefixMatch);

    const prefix = prefixMatch[0];
    const base64Part = ciphertext.slice(prefix.length);
    const blob = Buffer.from(base64Part, "base64url");

    const tamperedBlob = Buffer.from(blob);
    tamperedBlob[tamperedBlob.length - 1] ^= 0xff;

    const tamperedCiphertext = `${prefix}${tamperedBlob.toString("base64url")}`;

    const decryptResult = await adapter.decrypt({
      ciphertext: tamperedCiphertext,
      aad,
    });

    assert.strictEqual(decryptResult.success, false);
  });

  it("returns err with kind invalid_ciphertext when missing version prefix", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-noprefix");

    const decryptResult = await adapter.decrypt({
      ciphertext: "no-version-prefix-here",
      aad,
    });

    assert.strictEqual(decryptResult.success, false);
    if (!decryptResult.success) {
      assert.strictEqual(decryptResult.error.kind, "invalid_ciphertext");
    }
  });

  it("produces different ciphertexts for two encryptions of the same key (IV uniqueness)", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-iv-test");
    const rawKey = "sk-testivuniqueness123456789012345";

    const result1 = await adapter.encrypt({
      rawKey,
      aad,
      version: 1,
      provider: "openai",
    });
    const result2 = await adapter.encrypt({
      rawKey,
      aad,
      version: 1,
      provider: "openai",
    });

    assert.strictEqual(result1.success, true);
    assert.strictEqual(result2.success, true);
    if (result1.success && result2.success) {
      assert.notStrictEqual(result1.value.ciphertext, result2.value.ciphertext);
    }
  });

  it("produces ciphertext with correct version prefix", async () => {
    const adapter = new AesGcmEncryptionAdapter();
    const aad = constructAAD("user-prefix-test");

    const result = await adapter.encrypt({
      rawKey: "sk-testprefixkey12345678901234567",
      aad,
      version: 1,
      provider: "openai",
    });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.match(result.value.ciphertext, /^v1:/);
    }
  });

  it("returns default active key version of 1 when env not set", () => {
    delete process.env.ACTIVE_KEY_VERSION;
    const adapter = new AesGcmEncryptionAdapter();
    assert.strictEqual(adapter.getActiveKeyVersion(), 1);
  });

  it("returns configured active key version from env", () => {
    process.env.ACTIVE_KEY_VERSION = "3";
    const adapter = new AesGcmEncryptionAdapter();
    assert.strictEqual(adapter.getActiveKeyVersion(), 3);
    delete process.env.ACTIVE_KEY_VERSION;
  });
});
