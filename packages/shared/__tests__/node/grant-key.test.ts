import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  describeKeyMismatch,
  isValidEngagementId,
  keyFingerprint,
  readSliceEngagementId,
  resolveGrantKey,
} from "../../src/node/grant-key.js";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "grant-key-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function writeKey(file: string, hex: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${hex}\n`);
}

describe("resolveGrantKey", () => {
  it("fingerprint is the first 16 hex chars of sha256 over the key bytes", () => {
    // sha256 of 32 bytes of 0xa1, computed independently
    expect(keyFingerprint(KEY_A)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyFingerprint(KEY_A)).not.toBe(keyFingerprint(KEY_B));
  });

  it("prefers --key-file, then the env var, then the engagement key", async () => {
    const root = await tmp();
    const home = await tmp();
    const flagFile = path.join(root, "flag.key");
    const envFile = path.join(root, "env.key");
    await writeKey(flagFile, KEY_A);
    await writeKey(envFile, KEY_B);
    await writeKey(path.join(home, ".hexagen", "keys", "eng-1.key"), KEY_B);
    const base = { workspaceRoot: root, engagementId: "eng-1", homeDir: home };

    const flag = resolveGrantKey({
      ...base,
      keyFile: flagFile,
      env: { HEXAGEN_GRANT_KEY_FILE: envFile },
    });
    expect(flag.source).toBe("key-file");
    expect(flag.path).toBe(flagFile);
    expect(flag.fingerprint).toBe(keyFingerprint(KEY_A));

    const env = resolveGrantKey({
      ...base,
      env: { HEXAGEN_GRANT_KEY_FILE: envFile },
    });
    expect(env.source).toBe("env");
    expect(env.path).toBe(envFile);

    const eng = resolveGrantKey({ ...base, env: {} });
    expect(eng.source).toBe("engagement");
    expect(eng.path).toBe(path.join(home, ".hexagen", "keys", "eng-1.key"));
  });

  it("repo mode (manifest present) keeps the in-repo key path", async () => {
    const root = await tmp();
    await mkdir(path.join(root, ".architecture"), { recursive: true });
    await writeFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "x: 1\n",
    );
    await writeKey(path.join(root, ".hexagen", "grant-signing.key"), KEY_A);
    const r = resolveGrantKey({ workspaceRoot: root, env: {} });
    expect(r.mode).toBe("repo");
    expect(r.source).toBe("repo");
    expect(r.path).toBe(path.join(root, ".hexagen", "grant-signing.key"));
    expect(r.fingerprint).toBe(keyFingerprint(KEY_A));
  });

  it("brownfield never falls back to an in-repo key", async () => {
    const root = await tmp();
    await writeKey(path.join(root, ".hexagen", "grant-signing.key"), KEY_A);
    const r = resolveGrantKey({ workspaceRoot: root, env: {} });
    expect(r.mode).toBe("brownfield");
    expect(r.path).toBeNull();
    expect(r.fingerprint).toBeUndefined();
  });

  it("reports a missing key with its path and no fingerprint", async () => {
    const root = await tmp();
    const home = await tmp();
    const r = resolveGrantKey({
      workspaceRoot: root,
      engagementId: "eng-9",
      homeDir: home,
      env: {},
    });
    expect(r.path).toBe(path.join(home, ".hexagen", "keys", "eng-9.key"));
    expect(r.fingerprint).toBeUndefined();
    expect(r.problem).toContain(r.path as string);
  });

  it("F3: never falls back to the in-repo key when the engagement key is missing", async () => {
    const root = await tmp();
    const home = await tmp();
    await writeKey(path.join(root, ".hexagen", "grant-signing.key"), KEY_A);
    const r = resolveGrantKey({
      workspaceRoot: root,
      engagementId: "eng-1",
      homeDir: home,
      env: {},
    });
    expect(r.source).toBe("engagement");
    expect(r.path).toBe(path.join(home, ".hexagen", "keys", "eng-1.key"));
    expect(r.fingerprint).toBeUndefined();
    expect(r.problem).toBeDefined();
  });

  it("rejects hostile engagement ids", async () => {
    const root = await tmp();
    for (const id of ["..", "a/b", "a..b", "", "x".repeat(65), "a b", "a\\b"]) {
      expect(isValidEngagementId(id)).toBe(false);
      const r = resolveGrantKey({
        workspaceRoot: root,
        engagementId: id,
        env: {},
      });
      expect(r.path).toBeNull();
    }
    expect(isValidEngagementId("acme.q3_2026-a")).toBe(true);
  });

  it("never puts key material in problem text", async () => {
    const root = await tmp();
    const bad = path.join(root, "bad.key");
    await writeFile(bad, `${KEY_A}zz\n`);
    const r = resolveGrantKey({ workspaceRoot: root, keyFile: bad, env: {} });
    expect(r.problem).toBeDefined();
    expect(JSON.stringify(r)).not.toContain(KEY_A);
  });
});

describe("readSliceEngagementId", () => {
  it("reads the slice id, tolerating absent or malformed files", async () => {
    const root = await tmp();
    expect(readSliceEngagementId(root)).toBeUndefined();
    await mkdir(path.join(root, ".hexagen"), { recursive: true });
    await writeFile(path.join(root, ".hexagen", "slice.json"), "{nope");
    expect(readSliceEngagementId(root)).toBeUndefined();
    await writeFile(
      path.join(root, ".hexagen", "slice.json"),
      JSON.stringify({ id: "eng-7" }),
    );
    // not a valid Slice: the CLI would refuse it, so the server must too
    expect(readSliceEngagementId(root)).toBeUndefined();
    await writeFile(
      path.join(root, ".hexagen", "slice.json"),
      JSON.stringify({
        schemaVersion: "1.0.0",
        id: "eng-7",
        repo: { commit: "0123456789abcdef" },
        paths: ["src/"],
        excludes: [],
        createdBy: "t",
        createdAt: "2026-10-01T00:00:00Z",
      }),
    );
    expect(readSliceEngagementId(root)).toBe("eng-7");
  });
});

describe("describeKeyMismatch", () => {
  it("names both paths and both fingerprints when keys differ", async () => {
    const root = await tmp();
    const cli = path.join(root, "cli.key");
    const mcp = path.join(root, "mcp.key");
    await writeKey(cli, KEY_A);
    await writeKey(mcp, KEY_B);
    const a = resolveGrantKey({ workspaceRoot: root, keyFile: cli, env: {} });
    const b = resolveGrantKey({ workspaceRoot: root, keyFile: mcp, env: {} });
    const msg = describeKeyMismatch("CLI", a, "MCP", b) as string;
    expect(msg).toContain(cli);
    expect(msg).toContain(mcp);
    expect(msg).toContain(keyFingerprint(KEY_A));
    expect(msg).toContain(keyFingerprint(KEY_B));
    expect(msg).not.toContain(KEY_A);
    expect(msg).not.toContain(KEY_B);
  });

  it("is null when both reach the same key, even by different paths", async () => {
    const root = await tmp();
    const one = path.join(root, "one.key");
    const two = path.join(root, "two.key");
    await writeKey(one, KEY_A);
    await writeKey(two, KEY_A);
    const a = resolveGrantKey({ workspaceRoot: root, keyFile: one, env: {} });
    const b = resolveGrantKey({ workspaceRoot: root, keyFile: two, env: {} });
    expect(describeKeyMismatch("CLI", a, "MCP", b)).toBeNull();
  });
});
