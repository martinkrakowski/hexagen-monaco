/**
 * GrantSignatureAdapter against a real filesystem: proves a grant signed
 * with the trust root's own key verifies, and that every way trust can
 * fail to establish (no signature, no key file, wrong key, tampered
 * field, malformed hex) resolves to a plain "no" rather than a throw.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalGrantPayload,
  MANIFEST_WRITE_PATH,
  type Grant,
} from "../../../src/application/kernel/grant.js";
import { GrantSignatureAdapter } from "../../../src/infrastructure/adapters/grant-signature.adapter.js";

const TRUSTED_KEY_HEX =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff";
const OTHER_KEY_HEX =
  "ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff";

function baseGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-001",
    principal: "martin",
    agent: "agent-1",
    contexts: ["billing"],
    paths: [MANIFEST_WRITE_PATH],
    tools: ["hexagen_create_context"],
    mode: "write",
    expires_at: "2026-09-30T18:00:00.000Z",
    ...overrides,
  };
}

function signWith(keyHex: string, grant: Grant): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(canonicalGrantPayload(grant))
    .digest("hex");
}

async function withTrustedKey<T>(
  keyHex: string | null,
  fn: (workspaceRoot: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "grant-signature-test-"),
  );
  try {
    if (keyHex !== null) {
      const dir = path.join(tmpDir, ".hexagen");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "grant-signing.key"),
        `${keyHex}\n`,
        "utf-8",
      );
    }
    return await fn(tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("GrantSignatureAdapter", () => {
  it("verifies true for a grant signed with the trust root's own key", async () => {
    await withTrustedKey(TRUSTED_KEY_HEX, async (root) => {
      const grant = baseGrant();
      const signed = { ...grant, signature: signWith(TRUSTED_KEY_HEX, grant) };
      const result = await new GrantSignatureAdapter(root).verify(signed);
      assert.deepEqual(result, { success: true, value: true });
    });
  });

  it("verifies false when the grant has no signature at all", async () => {
    await withTrustedKey(TRUSTED_KEY_HEX, async (root) => {
      const result = await new GrantSignatureAdapter(root).verify(baseGrant());
      assert.deepEqual(result, { success: true, value: false });
    });
  });

  it("verifies false for a signature made with a different key", async () => {
    await withTrustedKey(TRUSTED_KEY_HEX, async (root) => {
      const grant = baseGrant();
      const forged = { ...grant, signature: signWith(OTHER_KEY_HEX, grant) };
      const result = await new GrantSignatureAdapter(root).verify(forged);
      assert.deepEqual(result, { success: true, value: false });
    });
  });

  it("verifies false when a signed field is tampered with after signing", async () => {
    await withTrustedKey(TRUSTED_KEY_HEX, async (root) => {
      const grant = baseGrant();
      const signature = signWith(TRUSTED_KEY_HEX, grant);
      const tampered = { ...grant, contexts: ["stripe"], signature };
      const result = await new GrantSignatureAdapter(root).verify(tampered);
      assert.deepEqual(result, { success: true, value: false });
    });
  });

  it("verifies false when no trust root key file exists (fails closed)", async () => {
    await withTrustedKey(null, async (root) => {
      const grant = baseGrant();
      const signed = { ...grant, signature: signWith(TRUSTED_KEY_HEX, grant) };
      const result = await new GrantSignatureAdapter(root).verify(signed);
      assert.deepEqual(result, { success: true, value: false });
    });
  });

  it("verifies false for malformed hex in either the signature or the key", async () => {
    await withTrustedKey(TRUSTED_KEY_HEX, async (root) => {
      const grant = baseGrant({ signature: "not-hex-at-all" });
      const result = await new GrantSignatureAdapter(root).verify(grant);
      assert.deepEqual(result, { success: true, value: false });
    });
    await withTrustedKey("not-hex-either", async (root) => {
      const grant = baseGrant();
      const signed = { ...grant, signature: signWith(TRUSTED_KEY_HEX, grant) };
      const result = await new GrantSignatureAdapter(root).verify(signed);
      assert.deepEqual(result, { success: true, value: false });
    });
  });
});
