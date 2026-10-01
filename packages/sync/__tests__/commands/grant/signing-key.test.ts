import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadOrCreateSigningKey } from "../../../src/commands/grant/signing-key.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "grant-signing-key-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("loadOrCreateSigningKey", () => {
  it("creates a fresh 32-byte hex key when none exists, and reports created: true", async () => {
    const workspaceRoot = await makeWorkspace();
    const result = await loadOrCreateSigningKey(workspaceRoot);
    assert.equal(result.created, true);
    assert.match(result.keyHex, /^[0-9a-f]{64}$/);
    const onDisk = (await readFile(result.path, "utf-8")).trim();
    assert.equal(onDisk, result.keyHex);
  });

  it("reads an existing key unchanged, and reports created: false", async () => {
    const workspaceRoot = await makeWorkspace();
    await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
      "deadbeef\n",
    );
    const result = await loadOrCreateSigningKey(workspaceRoot);
    assert.equal(result.created, false);
    assert.equal(result.keyHex, "deadbeef");
  });

  it("rejects a key file that isn't valid hex", async () => {
    const workspaceRoot = await makeWorkspace();
    await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
      "not hex!\n",
    );
    await assert.rejects(
      () => loadOrCreateSigningKey(workspaceRoot),
      /not valid hex/,
    );
  });

  it("issuing twice against the same workspace reuses the same key", async () => {
    const workspaceRoot = await makeWorkspace();
    const first = await loadOrCreateSigningKey(workspaceRoot);
    const second = await loadOrCreateSigningKey(workspaceRoot);
    assert.equal(first.keyHex, second.keyHex);
    assert.equal(second.created, false);
  });
});
