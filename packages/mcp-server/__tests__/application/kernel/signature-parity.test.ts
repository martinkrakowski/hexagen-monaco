/**
 * The CLI (`hexagen grant show|check`) and the MCP server verify grant
 * signatures with two separate implementations (sync's `verify.ts`, the
 * server's `GrantSignatureAdapter`). They must agree on every grant, or a
 * grant the CLI blesses could be denied at accept (or the reverse). Imports
 * sync's files by relative path, like `client-grant.test.ts`.
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalGrantPayload } from "../../../../sync/src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../../sync/src/commands/grant/sign.js";
import { verifyGrantSignature } from "../../../../sync/src/commands/grant/verify.js";
import { GrantSignatureAdapter } from "../../../src/infrastructure/adapters/grant-signature.adapter.js";
import type { Grant } from "../../../src/application/kernel/grant.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

const base = {
  id: "g-parity",
  principal: "fde",
  agent: "agent-1",
  paths: ["src/"],
  tools: ["hexagen_propose_patch"],
  mode: "propose" as const,
  expires_at: "2099-01-01T00:00:00Z",
};

async function both(
  grant: Grant,
  keyHex: string,
): Promise<{ cli: boolean; server: boolean }> {
  const root = await mkdtemp(path.join(tmpdir(), "parity-"));
  dirs.push(root);
  const keyFile = path.join(root, "k.key");
  await writeFile(keyFile, `${keyHex}\n`);
  const cli = verifyGrantSignature(grant, {
    workspaceRoot: root,
    keyFile,
    env: {},
  }).verified;
  const result = await new GrantSignatureAdapter(root, {
    keyFile,
    env: {},
  }).verify(grant);
  assert.equal(result.success, true);
  return { cli, server: result.success && result.value };
}

describe("CLI and server signature verification agree", () => {
  it("both accept a grant signed by the issuer's path", async () => {
    const keyHex = randomBytes(32).toString("hex");
    const grant: Grant = {
      ...base,
      signature: signGrantPayload(canonicalGrantPayload(base), keyHex),
    };
    assert.deepEqual(await both(grant, keyHex), { cli: true, server: true });
  });

  it("both deny the same grant with one byte of a field changed", async () => {
    const keyHex = randomBytes(32).toString("hex");
    const signature = signGrantPayload(canonicalGrantPayload(base), keyHex);
    const tampered: Grant = { ...base, paths: ["src0/"], signature };
    assert.deepEqual(await both(tampered, keyHex), {
      cli: false,
      server: false,
    });
  });

  it("both deny a one-byte change in the signature", async () => {
    const keyHex = randomBytes(32).toString("hex");
    const good = signGrantPayload(canonicalGrantPayload(base), keyHex);
    const flipped = (good[0] === "0" ? "1" : "0") + good.slice(1);
    assert.deepEqual(await both({ ...base, signature: flipped }, keyHex), {
      cli: false,
      server: false,
    });
  });

  it("both deny a short even-length signature and a missing one", async () => {
    const keyHex = randomBytes(32).toString("hex");
    assert.deepEqual(await both({ ...base, signature: "abcd" }, keyHex), {
      cli: false,
      server: false,
    });
    assert.deepEqual(await both({ ...base }, keyHex), {
      cli: false,
      server: false,
    });
  });
});
