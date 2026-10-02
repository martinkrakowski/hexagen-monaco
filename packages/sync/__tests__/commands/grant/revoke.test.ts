import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  rename,
  copyFile,
  chmod,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { grantKeyInitCommand } from "../../../src/commands/grant/key-init.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import { grantRevokeCommand } from "../../../src/commands/grant/revoke.js";
import { grantShowCommand } from "../../../src/commands/grant/show.js";
import { grantCheckCommand } from "../../../src/commands/grant/check.js";

const dirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(d);
  if (prefix === "rv-root-") execFileSync("git", ["init", "-q", d]);
  return d;
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  process.exitCode = 99;
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

const NOW = new Date("2026-10-01T12:00:00Z");
const text = (): string => out.join("\n");

interface Fixture {
  root: string;
  home: string;
  keyHex: string;
  keyPath: string;
  grantFile: string;
}

function signed(
  keyHex: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const grant = {
    id: "g-1",
    principal: "martin",
    agent: "lane-1",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: "2026-10-01T18:00:00Z",
    ...over,
  };
  return {
    ...grant,
    signature: signGrantPayload(canonicalGrantPayload(grant as never), keyHex),
  };
}

async function fixture(
  grantOver: Record<string, unknown> = {},
): Promise<Fixture> {
  const root = await tmp("rv-root-");
  const home = await tmp("rv-home-");
  await mkdir(path.join(root, ".hexagen", "grants"), { recursive: true });
  await writeFile(
    path.join(root, ".hexagen", "slice.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "eng-1",
      repo: { commit: "0123456789abcdef" },
      paths: ["src/"],
      excludes: [],
      createdBy: "test",
      createdAt: "2026-10-01T00:00:00Z",
    }),
  );
  await grantKeyInitCommand({ engagement: "eng-1", homeDir: home });
  const keyPath = path.join(home, ".hexagen", "keys", "eng-1.key");
  const keyHex = (await readFile(keyPath, "utf-8")).trim();
  const grantFile = path.join(root, ".hexagen", "grants", "g.json");
  await writeFile(
    grantFile,
    JSON.stringify(signed(keyHex, grantOver), null, 2),
  );
  return { root, home, keyHex, keyPath, grantFile };
}

function revoke(f: Fixture, extra: Record<string, unknown> = {}) {
  return grantRevokeCommand({
    grantFile: f.grantFile,
    workspaceRoot: f.root,
    homeDir: f.home,
    env: {},
    now: NOW,
    yes: true,
    ...extra,
  });
}

const read = async (f: Fixture): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(f.grantFile, "utf-8")) as Record<string, unknown>;

describe("grant revoke", () => {
  it("revokes, re-signs, and check denies with grant_revoked while show shows the window", async () => {
    const f = await fixture();
    await revoke(f, { at: "2026-10-01T11:00:00Z" });
    expect(process.exitCode).toBe(0);
    expect((await read(f)).revoked_at).toBe("2026-10-01T11:00:00Z");
    expect(text()).toContain("g-1");
    expect(text()).toContain(f.keyPath);
    expect(text()).toContain("fingerprint");
    out = [];

    await grantCheckCommand({
      grantFile: f.grantFile,
      tool: "hexagen_propose_patch",
      path: ["src/a.ts"],
      workspaceRoot: f.root,
      homeDir: f.home,
      env: {},
      now: NOW,
    });
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("was revoked at 2026-10-01T11:00:00Z");
    expect(text()).not.toContain("signature is not verified");
    out = [];

    await grantShowCommand({
      grantFile: f.grantFile,
      workspaceRoot: f.root,
      homeDir: f.home,
      env: {},
      now: NOW,
    });
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("revoked_at  2026-10-01T11:00:00Z");
    expect(text()).toContain("was revoked at");
    expect(text()).toContain("signature: verified");
  });

  it("defaults --at to now", async () => {
    const f = await fixture();
    await revoke(f);
    expect((await read(f)).revoked_at).toBe(NOW.toISOString());
  });

  it("a hand-edited revoked_at is denied as a signature failure by check", async () => {
    const f = await fixture();
    const g = await read(f);
    await writeFile(
      f.grantFile,
      JSON.stringify({ ...g, revoked_at: "2026-10-01T11:00:00Z" }),
    );
    await grantCheckCommand({
      grantFile: f.grantFile,
      tool: "hexagen_propose_patch",
      path: ["src/a.ts"],
      workspaceRoot: f.root,
      homeDir: f.home,
      env: {},
      now: NOW,
    });
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("signature is not verified");
    expect(text()).not.toContain("was revoked at");
  });

  it("is idempotent: a second revoke, or a later --at, writes nothing", async () => {
    const f = await fixture();
    await revoke(f, { at: "2026-10-01T11:00:00Z" });
    const before = await readFile(f.grantFile, "utf-8");
    const ino = (await stat(f.grantFile)).ino;
    out = [];
    await revoke(f);
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("already revoked at 2026-10-01T11:00:00Z");
    await revoke(f, { at: "2026-10-01T11:30:00Z" });
    expect(process.exitCode).toBe(0);
    expect(await readFile(f.grantFile, "utf-8")).toBe(before);
    expect((await stat(f.grantFile)).ino).toBe(ino);
  });

  it("an earlier --at moves the revocation earlier, still verifying", async () => {
    const f = await fixture();
    await revoke(f, { at: "2026-10-01T11:00:00Z" });
    await revoke(f, { at: "2026-10-01T10:00:00Z" });
    expect(process.exitCode).toBe(0);
    expect((await read(f)).revoked_at).toBe("2026-10-01T10:00:00Z");
    out = [];
    await grantShowCommand({
      grantFile: f.grantFile,
      workspaceRoot: f.root,
      homeDir: f.home,
      env: {},
      now: NOW,
    });
    expect(text()).toContain("signature: verified");
  });

  it("refuses a grant signed under a different key and leaves the file unchanged", async () => {
    const f = await fixture();
    await writeFile(
      f.grantFile,
      JSON.stringify(signed("cd".repeat(32)), null, 2),
    );
    const before = await readFile(f.grantFile, "utf-8");
    await revoke(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("signature is not verified");
    expect(await readFile(f.grantFile, "utf-8")).toBe(before);
  });

  it("writes nothing without --yes", async () => {
    const f = await fixture();
    const before = await readFile(f.grantFile, "utf-8");
    await revoke(f, { yes: false });
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("preflight");
    expect(text()).toContain("--yes");
    expect(await readFile(f.grantFile, "utf-8")).toBe(before);
  });

  it("replaces the file by atomic rename and leaves no temp files", async () => {
    const f = await fixture();
    const ino = (await stat(f.grantFile)).ino;
    await revoke(f);
    expect((await stat(f.grantFile)).ino).not.toBe(ino);
    expect(await readdir(path.dirname(f.grantFile))).toEqual(["g.json"]);
  });

  it("refuses a grant file outside .hexagen/ in brownfield", async () => {
    const f = await fixture();
    const outside = path.join(f.root, "g.json");
    await writeFile(outside, await readFile(f.grantFile, "utf-8"));
    const before = await readFile(outside, "utf-8");
    await revoke(f, { grantFile: outside });
    expect(process.exitCode).toBe(2);
    expect(text()).toContain(".hexagen");
    expect(await readFile(outside, "utf-8")).toBe(before);
  });

  it.each(["tomorrow", "2026-10-01T11:00:00", "2026-13-45T00:00:00Z"])(
    "exits 2 on an invalid --at (%s)",
    async (at) => {
      const f = await fixture();
      const before = await readFile(f.grantFile, "utf-8");
      await revoke(f, { at });
      expect(process.exitCode).toBe(2);
      expect(await readFile(f.grantFile, "utf-8")).toBe(before);
    },
  );

  it("never prints the key", async () => {
    const f = await fixture();
    await revoke(f, { yes: false });
    await revoke(f);
    await revoke(f);
    expect(text()).not.toContain(f.keyHex);
    expect(await readFile(f.grantFile, "utf-8")).not.toContain(f.keyHex);
  });

  it("warns on a future --at, and check still ALLOWs before it", async () => {
    const f = await fixture();
    await revoke(f, { at: "2026-10-01T15:00:00Z" });
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("warning: --at is in the future");
    expect(text()).not.toContain("at or after expires_at");
    out = [];
    await grantCheckCommand({
      grantFile: f.grantFile,
      tool: "hexagen_propose_patch",
      path: ["src/a.ts"],
      workspaceRoot: f.root,
      homeDir: f.home,
      env: {},
      now: NOW,
    });
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("ALLOW");
  });

  it("warns when --at is at or after expires_at", async () => {
    const f = await fixture();
    await revoke(f, { at: "2026-10-01T18:00:00Z" });
    expect(text()).toContain("warning: --at is at or after expires_at");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a grant file that is a symlink to an outside file",
    async () => {
      const f = await fixture();
      const outsideDir = await tmp("rv-outside-");
      const outside = path.join(outsideDir, "g.json");
      await writeFile(outside, await readFile(f.grantFile, "utf-8"));
      await rm(f.grantFile);
      await symlink(outside, f.grantFile);
      const before = await readFile(outside, "utf-8");
      await revoke(f);
      expect(process.exitCode).toBe(2);
      expect(await readFile(outside, "utf-8")).toBe(before);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves the grant file's mode",
    async () => {
      const f = await fixture();
      await chmod(f.grantFile, 0o640);
      await revoke(f);
      expect((await stat(f.grantFile)).mode & 0o777).toBe(0o640);
    },
  );

  it("revokes in repo mode with the in-repo key, showing [repo]", async () => {
    const root = await tmp("rv-root-");
    const home = await tmp("rv-home-");
    await mkdir(path.join(root, ".architecture"), { recursive: true });
    await writeFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "x: 1\n",
    );
    await mkdir(path.join(root, ".hexagen"), { recursive: true });
    const keyHex = "ab".repeat(32);
    await writeFile(
      path.join(root, ".hexagen", "grant-signing.key"),
      keyHex + "\n",
    );
    const grantFile = path.join(root, "g.json");
    await writeFile(
      grantFile,
      JSON.stringify(signed(keyHex, { paths: ["lib/"] })),
    );
    const f: Fixture = {
      root,
      home,
      keyHex,
      keyPath: path.join(root, ".hexagen", "grant-signing.key"),
      grantFile,
    };
    await revoke(f, { at: "2026-10-01T11:00:00Z" });
    expect(process.exitCode).toBe(0);
    expect((await read(f)).revoked_at).toBe("2026-10-01T11:00:00Z");
    expect(text()).toContain("[repo]");
    expect(text()).not.toContain(keyHex);
    out = [];
    await grantShowCommand({
      grantFile,
      workspaceRoot: root,
      homeDir: home,
      env: {},
      now: NOW,
    });
    expect(text()).toContain("signature: verified");
  });

  it.skipIf(process.platform === "win32")(
    "refuses when an ancestor is swapped to an outside symlink after the preflight",
    async () => {
      const f = await fixture();
      const outsideDir = await tmp("rv-outside-");
      const outside = path.join(outsideDir, "g.json");
      await writeFile(outside, await readFile(f.grantFile, "utf-8"));
      const before = await readFile(outside, "utf-8");
      const dir = path.dirname(f.grantFile);
      await revoke(f, {
        beforeRename: async () => {
          await rename(dir, `${dir}-moved`);
          await symlink(outsideDir, dir);
          // Make the redirected rename succeed if nothing stops it.
          for (const name of await readdir(`${dir}-moved`)) {
            if (name.endsWith(".tmp")) {
              await copyFile(
                `${dir}-moved/${name}`,
                path.join(outsideDir, name),
              );
            }
          }
        },
      });
      expect(process.exitCode).toBe(2);
      expect(await readFile(outside, "utf-8")).toBe(before);
      expect(await readdir(outsideDir)).toEqual(["g.json"]);
    },
  );

  it("exits 2 and leaves the file unchanged when the lock is already held", async () => {
    const f = await fixture();
    const lock = `${f.grantFile}.lock`;
    await writeFile(lock, "12345\n");
    const before = await readFile(f.grantFile, "utf-8");
    await revoke(f);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("another revoke");
    expect(await readFile(f.grantFile, "utf-8")).toBe(before);
    expect(await readFile(lock, "utf-8")).toBe("12345\n");
  });

  it("removes its lock after a successful revoke", async () => {
    const f = await fixture();
    await revoke(f);
    expect(await readdir(path.dirname(f.grantFile))).toEqual(["g.json"]);
  });

  it.skipIf(process.platform === "win32")(
    "keeps permission bits the umask would strip",
    async () => {
      const f = await fixture();
      await chmod(f.grantFile, 0o666);
      const old = process.umask(0o022);
      try {
        await revoke(f);
      } finally {
        process.umask(old);
      }
      expect((await stat(f.grantFile)).mode & 0o777).toBe(0o666);
    },
  );

  it("warns, naming both keys, when --key-file differs from the server default", async () => {
    const f = await fixture();
    const otherHex = "cd".repeat(32);
    const otherKey = path.join(f.home, "other.key");
    await writeFile(otherKey, otherHex + "\n");
    await writeFile(f.grantFile, JSON.stringify(signed(otherHex), null, 2));
    await revoke(f, { keyFile: otherKey });
    expect(process.exitCode).toBe(0);
    const t = text();
    expect(t).toContain("grant key mismatch");
    expect(t).toContain(otherKey);
    expect(t).toContain(f.keyPath);
    expect(t).toContain("signature failure");
    expect(t).not.toContain(otherHex);
  });

  it("does not warn when no override is given", async () => {
    const f = await fixture();
    await revoke(f);
    expect(text()).not.toContain("grant key mismatch");
  });
});
