import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { grantKeyInitCommand } from "../../../src/commands/grant/key-init.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import { grantShowCommand } from "../../../src/commands/grant/show.js";
import { grantCheckCommand } from "../../../src/commands/grant/check.js";
import { realpathSync } from "node:fs";

const dirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(d);
  if (prefix === "sc-root-") execFileSync("git", ["init", "-q", d]);
  return d;
}

let out: string[];
beforeEach(() => {
  out = [];
  // A sentinel: a command that forgets to set its exit code must not pass as 0.
  process.exitCode = 99;
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

interface Fixture {
  root: string;
  home: string;
  keyHex: string;
  keyPath: string;
  grantFile: string;
}

async function writeSlice(
  root: string,
  id: string,
  paths: string[],
  excludes: string[] = [],
): Promise<void> {
  await mkdir(path.join(root, ".hexagen"), { recursive: true });
  await writeFile(
    path.join(root, ".hexagen", "slice.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      id,
      repo: { commit: "0123456789abcdef" },
      paths,
      excludes,
      createdBy: "test",
      createdAt: "2026-10-01T00:00:00Z",
    }),
  );
}

async function mintKey(
  home: string,
  id: string,
): Promise<{ keyHex: string; keyPath: string }> {
  await grantKeyInitCommand({ engagement: id, homeDir: home });
  const keyPath = path.join(home, ".hexagen", "keys", `${id}.key`);
  return { keyHex: (await readFile(keyPath, "utf-8")).trim(), keyPath };
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
  slicePaths: string[] = ["src/"],
  excludes: string[] = [],
): Promise<Fixture> {
  const root = await tmp("sc-root-");
  const home = await tmp("sc-home-");
  await writeSlice(root, "eng-1", slicePaths, excludes);
  const { keyHex, keyPath } = await mintKey(home, "eng-1");
  const grantFile = path.join(root, ".hexagen", "grants", "g.json");
  await mkdir(path.dirname(grantFile), { recursive: true });
  await writeFile(
    grantFile,
    JSON.stringify(signed(keyHex, grantOver), null, 2),
  );
  return { root, home, keyHex, keyPath, grantFile };
}

const text = (): string => out.join("\n");

async function repoFixture(): Promise<Fixture> {
  const root = await tmp("sc-root-");
  const home = await tmp("sc-home-");
  await mkdir(path.join(root, ".architecture"), { recursive: true });
  await writeFile(path.join(root, ".architecture", "manifest.yaml"), "x: 1\n");
  await mkdir(path.join(root, ".hexagen"), { recursive: true });
  const keyPath = path.join(root, ".hexagen", "grant-signing.key");
  const keyHex = "ab".repeat(32);
  await writeFile(keyPath, keyHex + "\n");
  const grantFile = path.join(root, "g.json");
  await writeFile(
    grantFile,
    JSON.stringify(signed(keyHex, { paths: ["lib/"] })),
  );
  return { root, home, keyHex, keyPath, grantFile };
}

function show(f: Fixture, extra: Record<string, unknown> = {}) {
  return grantShowCommand({
    grantFile: f.grantFile,
    workspaceRoot: f.root,
    homeDir: f.home,
    env: {},
    now: NOW,
    ...extra,
  });
}

function check(
  f: Fixture,
  tool: string | undefined,
  paths: string[],
  extra: Record<string, unknown> = {},
) {
  return grantCheckCommand({
    grantFile: f.grantFile,
    tool,
    path: paths,
    workspaceRoot: f.root,
    homeDir: f.home,
    env: {},
    now: NOW,
    ...extra,
  });
}

describe("grant show", () => {
  it("pretty-prints a verified grant and exits 0 without printing the key", async () => {
    const f = await fixture({ max_files: 3 });
    await show(f);
    expect(process.exitCode).toBe(0);
    const t = text();
    for (const needle of [
      "g-1",
      "martin",
      "lane-1",
      "src/",
      "hexagen_propose_patch",
      "propose",
      "2026-10-01T18:00:00Z",
      "max_files",
      "verified",
      f.keyPath,
    ]) {
      expect(t).toContain(needle);
    }
    expect(t).not.toContain("contexts");
    expect(t).not.toContain("NOT verified");
    expect(t).not.toContain(f.keyHex);
    expect(t).toMatch(/fingerprint\s+[0-9a-f]{16}\b/);
  });

  it("prints contexts when the grant carries them", async () => {
    const f = await fixture({ contexts: ["billing"] });
    await show(f);
    expect(text()).toContain("billing");
  });

  it("a tampered grant (one path flipped) exits 1 and says the signature fails", async () => {
    const f = await fixture();
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.paths = ["lib/"];
    await writeFile(f.grantFile, JSON.stringify(raw));
    await show(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("NOT verified");
    expect(text()).toMatch(/signature/i);
    expect(text()).not.toContain(f.keyHex);
  });

  it("a hand-edited revoked_at fails the signature, a signed revoked grant shows revoked_at", async () => {
    const f = await fixture({ revoked_at: "2026-10-01T10:00:00Z" });
    await show(f);
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("revoked_at");
    expect(text()).toContain(
      "window: Grant 'g-1' was revoked at 2026-10-01T10:00:00Z",
    );
    out.length = 0;
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    delete raw.revoked_at;
    await writeFile(f.grantFile, JSON.stringify(raw));
    await show(f);
    expect(process.exitCode).toBe(1);
  });

  it("a weak key exits 1 with the reason and never the key", async () => {
    const f = await fixture();
    await writeFile(f.keyPath, "abcd\n");
    await show(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("NOT verified");
    expect(text()).toContain("64 hex");
  });

  it("a missing key exits 1 naming the path", async () => {
    const f = await fixture();
    await rm(f.keyPath);
    await show(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain(f.keyPath);
  });

  it("bad input exits 2: missing file, not JSON, wrong shape", async () => {
    const f = await fixture();
    await show(f, { grantFile: path.join(f.root, "nope.json") });
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await writeFile(f.grantFile, "{not json");
    await show(f);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await writeFile(f.grantFile, JSON.stringify({ id: "x" }));
    await show(f);
    expect(process.exitCode).toBe(2);
  });

  it("an invalid slice.json exits 2 with the parse problem, like check", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, ".hexagen", "slice.json"), "{nope");
    await show(f);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("slice.json is not a valid slice");
  });

  it("a grant with an extra key exits 2", async () => {
    const f = await fixture();
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.extra = 1;
    await writeFile(f.grantFile, JSON.stringify(raw));
    await show(f);
    expect(process.exitCode).toBe(2);
  });

  it("--key-file overrides the engagement key", async () => {
    const f = await fixture();
    const other = await mintKey(f.home, "other");
    await show(f, { keyFile: other.keyPath });
    expect(process.exitCode).toBe(1);
    expect(text()).toContain(other.keyPath);
  });
});

describe("grant check (Field Kit form)", () => {
  it("allows a granted tool and path, exit 0, printing root, key path and fingerprint", async () => {
    const f = await fixture();
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(0);
    const t = text();
    expect(t).toContain("ALLOW");
    expect(t).toContain(f.root);
    expect(t).toContain(f.keyPath);
    expect(t).toMatch(/fingerprint\s+[0-9a-f]{16}\b/);
    expect(t).not.toContain(f.keyHex);
  });

  it("does not run the mode check: a propose-only grant is allowed", async () => {
    const f = await fixture({ mode: "propose" });
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(0);
  });

  it("denies a tool the grant does not name", async () => {
    const f = await fixture();
    await check(f, "other_tool", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("DENY");
    expect(text()).toContain("other_tool");
  });

  it("denies a path the grant does not name", async () => {
    const f = await fixture({}, ["src/", "lib/"]);
    await check(f, "hexagen_propose_patch", ["lib/x.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("lib/x.ts");
  });

  it("denies a path outside the slice even when the grant allows it", async () => {
    const f = await fixture({ paths: ["src/", "lib/"] }, ["src/"]);
    await check(f, "hexagen_propose_patch", ["lib/x.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/slice/);
    expect(text()).toContain("lib/x.ts");
  });

  it("denies a path inside a slice exclude even when the grant allows it", async () => {
    const f = await fixture({ paths: ["src/"] }, ["src/"], ["src/gen/"]);
    await check(f, "hexagen_propose_patch", ["src/gen/y.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/exclude|slice/);
  });

  it("denies an expired grant", async () => {
    const f = await fixture({ expires_at: "2026-10-01T11:00:00Z" });
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/expired/);
  });

  it("denies a revoked grant", async () => {
    const f = await fixture({ revoked_at: "2026-10-01T10:00:00Z" });
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/revoked/);
  });

  it("denies a tampered grant with a signature reason", async () => {
    const f = await fixture();
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.paths = ["src/", "lib/"];
    await writeFile(f.grantFile, JSON.stringify(raw));
    await check(f, "hexagen_propose_patch", ["lib/x.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/signature/i);
  });

  it("denies on a weak key and on a missing key, never printing the key", async () => {
    const f = await fixture();
    await writeFile(f.keyPath, "abcd\n");
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("64 hex");
    process.exitCode = 0;
    out.length = 0;
    await rm(f.keyPath);
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain(f.keyPath);
    expect(text()).not.toContain(f.keyHex);
  });

  it("denies a grant signed under a different engagement key, naming both fingerprints", async () => {
    const f = await fixture();
    // The slice still names eng-1 (the server default); the operator verifies
    // with another engagement's key.
    const other = await mintKey(f.home, "eng-2");
    await check(f, "hexagen_propose_patch", ["src/a.ts"], {
      engagement: "eng-2",
    });
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/signature/i);
    expect(text()).toContain(f.keyPath);
    expect(text()).toContain(other.keyPath);
    expect(text()).not.toContain(f.keyHex);
    expect(text()).not.toContain(other.keyHex);
    const fingerprints = text().match(/fingerprint [0-9a-f]{16}/g) ?? [];
    expect(new Set(fingerprints).size).toBeGreaterThanOrEqual(2);
  });

  it("bad input exits 2: no tool, no path, a transaction id (monaco form deferred), a bad path", async () => {
    const f = await fixture();
    await check(f, undefined, ["src/a.ts"]);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await check(f, "hexagen_propose_patch", []);
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
    await check(f, "hexagen_propose_patch", ["src/a.ts"], {
      transactionId: "tx-1",
    });
    expect(process.exitCode).toBe(2);
    expect(text()).toMatch(/not (yet )?(built|available|supported)|deferred/i);
    process.exitCode = 0;
    await check(f, "hexagen_propose_patch", ["../etc/passwd"]);
    expect(process.exitCode).toBe(2);
  });

  it("an unreadable grant file exits 2", async () => {
    const f = await fixture();
    await check(f, "hexagen_propose_patch", ["src/a.ts"], {
      grantFile: path.join(f.root, "missing.json"),
    });
    expect(process.exitCode).toBe(2);
  });

  it("denies when there is no slice.json in a client repo", async () => {
    const f = await fixture();
    await rm(path.join(f.root, ".hexagen", "slice.json"));
    await check(f, "hexagen_propose_patch", ["src/a.ts"], {
      engagement: "eng-1",
    });
    expect(process.exitCode).toBe(1);
    expect(text()).toContain(
      "no .hexagen/slice.json: in a client repo the slice bounds every write; create one first",
    );
    expect(text()).not.toContain("ALLOW");
  });

  it("an invalid slice.json exits 2", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, ".hexagen", "slice.json"), "{nope");
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(2);
  });

  it("a grant with an extra key exits 2", async () => {
    const f = await fixture();
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.extra = 1;
    await writeFile(f.grantFile, JSON.stringify(raw));
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(2);
  });

  it("repo mode (manifest present): the Field Kit form exits 2", async () => {
    const f = await repoFixture();
    await check(f, "hexagen_propose_patch", ["lib/x.ts"]);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain(
      "the Field Kit form is for client repos; in a repo with a manifest, mutations are checked at accept",
    );
    expect(text()).not.toContain("ALLOW");
  });

  it("repo mode: show still verifies with the in-repo key", async () => {
    const f = await repoFixture();
    await show(f);
    expect(process.exitCode).toBe(0);
    expect(text()).toContain(f.keyPath);
    expect(text()).toContain("[repo]");
    expect(text()).not.toContain(f.keyHex);
  });

  it("a tampered and expired grant reports the signature first", async () => {
    const f = await fixture({ expires_at: "2026-10-01T11:00:00Z" });
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.paths = ["src/", "lib/"];
    await writeFile(f.grantFile, JSON.stringify(raw));
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/signature/i);
    expect(text()).not.toMatch(/expired/);
  });

  it("a short even-length hex signature is denied without throwing", async () => {
    const f = await fixture();
    const raw = JSON.parse(await readFile(f.grantFile, "utf-8"));
    raw.signature = "abcd";
    await writeFile(f.grantFile, JSON.stringify(raw));
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(1);
    expect(text()).toMatch(/signature/i);
    expect(text()).toContain("DENY");
  });

  it("never prints key hex on any path of a full run", async () => {
    const f = await fixture();
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    await check(f, "nope", ["src/a.ts"]);
    await show(f);
    expect(text()).not.toContain(f.keyHex);
  });
});

describe("root discovery, validation and diagnostics", () => {
  const cwd0 = process.cwd();
  afterEach(() => process.chdir(cwd0));

  it("uses the git toplevel when run from a subdirectory (no workspace-root flag)", async () => {
    const f = await fixture();
    await mkdir(path.join(f.root, "src", "deep"), { recursive: true });
    process.chdir(path.join(f.root, "src", "deep"));
    for (const run of [
      () =>
        grantCheckCommand({
          grantFile: f.grantFile,
          tool: "hexagen_propose_patch",
          path: ["src/a.ts"],
          homeDir: f.home,
          env: {},
          now: NOW,
        }),
      () =>
        grantShowCommand({
          grantFile: f.grantFile,
          homeDir: f.home,
          env: {},
          now: NOW,
        }),
    ]) {
      out.length = 0;
      process.exitCode = 99;
      await run();
      expect(process.exitCode).toBe(0);
      expect(text()).toContain(realpathSync.native(f.root));
    }
  });

  it("a malformed ancestor package.json exits 2 with the message, in both commands", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "package.json"), "{bad");
    process.chdir(f.root);
    const o = { grantFile: f.grantFile, homeDir: f.home, env: {}, now: NOW };
    await grantShowCommand(o);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("Unreadable package.json");
    out.length = 0;
    process.exitCode = 99;
    await grantCheckCommand({
      ...o,
      tool: "hexagen_propose_patch",
      path: ["src/a.ts"],
    });
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("Unreadable package.json");
  });

  it.each([
    ["no offset", "2026-10-01T18:00:00"],
    ["not a date", "tomorrow"],
    ["impossible date", "2026-13-45T00:00:00Z"],
    ["date only", "2026-10-01"],
  ])("an invalid expires_at (%s) exits 2 in both commands", async (_n, ts) => {
    const f = await fixture({ expires_at: ts });
    await show(f);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("expires_at");
    process.exitCode = 99;
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(2);
  });

  it("an invalid revoked_at exits 2 in both commands", async () => {
    const f = await fixture({ revoked_at: "yesterday" });
    await show(f);
    expect(process.exitCode).toBe(2);
    expect(text()).toContain("revoked_at");
    process.exitCode = 99;
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(2);
  });

  it("accepts offset timestamps", async () => {
    const f = await fixture({ expires_at: "2026-10-01T20:00:00+02:00" });
    await check(f, "hexagen_propose_patch", ["src/a.ts"]);
    expect(process.exitCode).toBe(0);
  });

  it("a missing --engagement override still names the server-default key", async () => {
    const f = await fixture();
    await check(f, "hexagen_propose_patch", ["src/a.ts"], {
      engagement: "eng-9",
    });
    expect(process.exitCode).toBe(1);
    const t = text();
    expect(t).toContain("grant key mismatch");
    expect(t).toContain(f.keyPath);
    expect(t).toContain("eng-9.key");
    expect(t).toMatch(/fingerprint [0-9a-f]{16}/);
  });

  it("a weak --key-file override still names the server-default key", async () => {
    const f = await fixture();
    const weak = path.join(f.home, "weak.key");
    await writeFile(weak, "abcd\n");
    await show(f, { keyFile: weak });
    expect(process.exitCode).toBe(1);
    const t = text();
    expect(t).toContain("64 hex");
    expect(t).toContain("grant key mismatch");
    expect(t).toContain(f.keyPath);
  });
});

describe("the command line", () => {
  const savedHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = savedHome;
  });

  async function run(f: Fixture, args: string[]): Promise<void> {
    process.env.HOME = f.home;
    process.exitCode = 99;
    out.length = 0;
    vi.resetModules();
    const { grantCommander } =
      await import("../../../src/commands/grant/index.js");
    await grantCommander.parseAsync(
      ["check", f.grantFile, "--workspace-root", f.root, ...args],
      { from: "user" },
    );
  }

  const far = { expires_at: "2099-01-01T00:00:00Z" };

  it("repeated --path keeps every path: a denied first path is not lost", async () => {
    const f = await fixture({ ...far, paths: ["src/allowed.txt"] }, ["src/"]);
    await run(f, [
      "--tool",
      "hexagen_propose_patch",
      "--path",
      "src/denied.txt",
      "--path",
      "src/allowed.txt",
    ]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("src/denied.txt");
    await run(f, [
      "--tool",
      "hexagen_propose_patch",
      "--path",
      "src/allowed.txt",
      "--path",
      "src/denied.txt",
    ]);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("src/denied.txt");
  });

  it("space-separated and repeated forms agree, and all paths are checked", async () => {
    const f = await fixture({ ...far, paths: ["src/"] });
    await run(f, [
      "--tool",
      "hexagen_propose_patch",
      "--path",
      "src/a.ts",
      "src/b.ts",
      "--path",
      "src/c.ts",
    ]);
    expect(process.exitCode).toBe(0);
    expect(text()).toContain("3 path(s)");
  });

  it("a repeated --tool exits 2", async () => {
    const f = await fixture(far);
    await run(f, [
      "--tool",
      "hexagen_propose_patch",
      "--tool",
      "other",
      "--path",
      "src/a.ts",
    ]);
    expect(process.exitCode).toBe(2);
  });
});
