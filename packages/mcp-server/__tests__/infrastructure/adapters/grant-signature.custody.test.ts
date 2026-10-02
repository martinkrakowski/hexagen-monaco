/**
 * Key custody for client repos: the verifier reads the same key the issuer
 * signed with, found by the shared resolver, and fails closed with a stated
 * reason when it cannot.
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describeKeyMismatch,
  keyFingerprint,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  canonicalGrantPayload,
  type Grant,
} from "../../../src/application/kernel/grant.js";
import { GrantSignatureAdapter } from "../../../src/infrastructure/adapters/grant-signature.adapter.js";

const KEY = "a1".repeat(32);
const OTHER = "b2".repeat(32);

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "grant-custody-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length > 0) {
    await fs.rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

/** A client-repo grant: no `contexts` key at all. */
function clientGrant(keyHex: string): Grant {
  const grant: Grant = {
    id: "g-1",
    principal: "p",
    agent: "a",
    paths: ["src/"],
    tools: ["write_file"],
    mode: "write",
    expires_at: "2026-12-01T00:00:00.000Z",
  };
  const signature = createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(canonicalGrantPayload(grant))
    .digest("hex");
  return { ...grant, signature };
}

async function writeKey(file: string, hex: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${hex}\n`);
}

describe("GrantSignatureAdapter key custody", () => {
  it("brownfield: verifies a contexts-less grant against ~/.hexagen/keys/<slice id>.key", async () => {
    const root = await tmp();
    const home = await tmp();
    await fs.mkdir(path.join(root, ".hexagen"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".hexagen", "slice.json"),
      JSON.stringify({ id: "eng-1" }),
    );
    await writeKey(path.join(home, ".hexagen", "keys", "eng-1.key"), KEY);
    const adapter = new GrantSignatureAdapter(root, { env: {}, homeDir: home });
    assert.deepEqual(await adapter.verify(clientGrant(KEY)), {
      success: true,
      value: true,
    });
    assert.deepEqual(await adapter.verify(clientGrant(OTHER)), {
      success: true,
      value: false,
    });
  });

  it("brownfield: an in-repo key is NOT trusted without a manifest", async () => {
    const root = await tmp();
    await writeKey(path.join(root, ".hexagen", "grant-signing.key"), KEY);
    const adapter = new GrantSignatureAdapter(root, { env: {} });
    assert.deepEqual(await adapter.verify(clientGrant(KEY)), {
      success: true,
      value: false,
    });
    assert.match(adapter.describeKey(), /no key location/);
  });

  it("--key-file and HEXAGEN_GRANT_KEY_FILE select the key (flag wins)", async () => {
    const root = await tmp();
    const flagKey = path.join(root, "flag.key");
    const envKey = path.join(root, "env.key");
    await writeKey(flagKey, KEY);
    await writeKey(envKey, OTHER);
    const viaEnv = new GrantSignatureAdapter(root, {
      env: { HEXAGEN_GRANT_KEY_FILE: envKey },
    });
    assert.equal((await viaEnv.verify(clientGrant(OTHER))).success, true);
    assert.deepEqual(await viaEnv.verify(clientGrant(OTHER)), {
      success: true,
      value: true,
    });
    const viaFlag = new GrantSignatureAdapter(root, {
      keyFile: flagKey,
      env: { HEXAGEN_GRANT_KEY_FILE: envKey },
    });
    assert.deepEqual(await viaFlag.verify(clientGrant(KEY)), {
      success: true,
      value: true,
    });
  });

  it("describeKey names root, path and fingerprint, never the key", async () => {
    const root = await tmp();
    const file = path.join(root, "k.key");
    await writeKey(file, KEY);
    const line = new GrantSignatureAdapter(root, {
      keyFile: file,
      env: {},
    }).describeKey();
    assert.ok(line.includes(root));
    assert.ok(line.includes(file));
    assert.ok(line.includes(keyFingerprint(KEY)));
    assert.ok(!line.includes(KEY));
  });

  it("a CLI and MCP that reach different keys have the mismatch named, both paths and fingerprints", async () => {
    const root = await tmp();
    const cliKey = path.join(root, "cli.key");
    const mcpKey = path.join(root, "mcp.key");
    await writeKey(cliKey, KEY);
    await writeKey(mcpKey, OTHER);
    const cli = resolveGrantKey({
      workspaceRoot: root,
      keyFile: cliKey,
      env: {},
    });
    const mcp = resolveGrantKey({
      workspaceRoot: root,
      env: { HEXAGEN_GRANT_KEY_FILE: mcpKey },
    });
    const msg = describeKeyMismatch("CLI", cli, "MCP", mcp);
    assert.ok(msg);
    for (const needle of [
      cliKey,
      mcpKey,
      keyFingerprint(KEY),
      keyFingerprint(OTHER),
    ]) {
      assert.ok(msg.includes(needle), `missing ${needle}`);
    }
    assert.ok(!msg.includes(KEY) && !msg.includes(OTHER));
    // and the grant signed by the CLI's key is denied by the MCP's
    const adapter = new GrantSignatureAdapter(root, {
      env: { HEXAGEN_GRANT_KEY_FILE: mcpKey },
    });
    assert.deepEqual(await adapter.verify(clientGrant(KEY)), {
      success: true,
      value: false,
    });
  });
});
