import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadOrCreateSigningKey } from "../../../src/commands/grant/signing-key.js";

const tempDirs: string[] = [];

const FULL_STRENGTH_KEY = "a".repeat(64);

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

  it("adds a .hexagen ignore entry when creating a fresh key", async () => {
    const workspaceRoot = await makeWorkspace();
    await loadOrCreateSigningKey(workspaceRoot);
    const gitignore = await readFile(
      path.join(workspaceRoot, ".gitignore"),
      "utf-8",
    );
    assert.match(gitignore, /\.hexagen\/grant-signing\.key/);
  });

  it("does not duplicate an existing .gitignore entry covering the key", async () => {
    const workspaceRoot = await makeWorkspace();
    await writeFile(
      path.join(workspaceRoot, ".gitignore"),
      "node_modules/\n.hexagen/\n",
    );
    await loadOrCreateSigningKey(workspaceRoot);
    const gitignore = await readFile(
      path.join(workspaceRoot, ".gitignore"),
      "utf-8",
    );
    assert.equal(gitignore, "node_modules/\n.hexagen/\n");
  });

  it("reads an existing full-strength key unchanged, and reports created: false", async () => {
    const workspaceRoot = await makeWorkspace();
    await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
      `${FULL_STRENGTH_KEY}\n`,
    );
    const result = await loadOrCreateSigningKey(workspaceRoot);
    assert.equal(result.created, false);
    assert.equal(result.keyHex, FULL_STRENGTH_KEY);
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
      /64 hex characters/,
    );
  });

  it("rejects an existing key shorter than 32 bytes", async () => {
    const workspaceRoot = await makeWorkspace();
    await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
      "deadbeef\n",
    );
    await assert.rejects(
      () => loadOrCreateSigningKey(workspaceRoot),
      /64 hex characters/,
    );
  });

  it("rejects an existing key with odd-length hex", async () => {
    const workspaceRoot = await makeWorkspace();
    await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
      `${FULL_STRENGTH_KEY.slice(0, -1)}\n`,
    );
    await assert.rejects(
      () => loadOrCreateSigningKey(workspaceRoot),
      /64 hex characters/,
    );
  });

  it("issuing twice against the same workspace reuses the same key", async () => {
    const workspaceRoot = await makeWorkspace();
    const first = await loadOrCreateSigningKey(workspaceRoot);
    const second = await loadOrCreateSigningKey(workspaceRoot);
    assert.equal(first.keyHex, second.keyHex);
    assert.equal(second.created, false);
  });

  it("concurrent first-use creation converges on one key, not whichever wrote last", async () => {
    const workspaceRoot = await makeWorkspace();
    const [first, second] = await Promise.all([
      loadOrCreateSigningKey(workspaceRoot),
      loadOrCreateSigningKey(workspaceRoot),
    ]);
    assert.equal(first.keyHex, second.keyHex);
    assert.equal(
      [first.created, second.created].filter(Boolean).length,
      1,
      "exactly one caller should report created: true",
    );
  });
});
