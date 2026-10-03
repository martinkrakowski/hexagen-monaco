import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { grantKeyInitCommand } from "../../../src/commands/grant/key-init.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import {
  grantListCommand,
  type GrantListOptions,
  type GrantListRow,
} from "../../../src/commands/grant/list.js";

/**
 * `hexagen grant list` (plan 4, lane 4B): acceptance tests 1-9 of
 * docs/planning/2026-10-03_kit-04-grant-lifecycle.md. Every fixture is minted
 * here — nothing reads a committed `.hexagen/` (plan §2).
 *
 * The shape of the assertions is the plan's: a symlink is a row, never a
 * whole-call failure; every refusal becomes a row; and a signature failure the
 * `--status` filter hides still decides the exit code.
 */

const NOW = new Date("2026-10-01T12:00:00Z");
const SECRET = "SECRET-MATERIAL-MUST-NOT-LEAK";

const dirs: string[] = [];
let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  // A sentinel: a command that forgets to set its exit code must not pass as 0.
  process.exitCode = 99;
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    err.push(a.join(" "));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function tmp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  if (prefix === "gl-root-") execFileSync("git", ["init", "-q", dir]);
  return dir;
}

const text = (): string => out.join("\n");
const errors = (): string => err.join("\n");
const everything = (): string => `${text()}\n${errors()}`;

interface Fixture {
  root: string;
  home: string;
  keyHex: string;
  keyPath: string;
  grants: string;
}

async function writeSlice(root: string, id: string): Promise<void> {
  await mkdir(path.join(root, ".hexagen"), { recursive: true });
  await writeFile(
    path.join(root, ".hexagen", "slice.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      id,
      repo: { commit: "0123456789abcdef" },
      paths: ["src/"],
      excludes: [],
      createdBy: "test",
      createdAt: "2026-10-01T00:00:00Z",
    }),
  );
}

/** A grant signed under the fixture key. `over` is applied before signing, so a
 *  grant that carries `revoked_at` here is a *signed* revocation. */
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

/** Writes a grant file into `<root>/.hexagen/grants/`, signed unless `raw`. */
async function put(
  root: string,
  name: string,
  keyHex: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  const file = path.join(root, ".hexagen", "grants", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(signed(keyHex, over), null, 2));
  return file;
}

/**
 * A client repo with `.hexagen/grants/` holding one live, one expired and one
 * revoked grant (a signed revocation, as `hexagen grant revoke` writes it).
 */
async function fixture(): Promise<Fixture> {
  const root = await tmp("gl-root-");
  const home = await tmp("gl-home-");
  await writeSlice(root, "eng-1");
  await grantKeyInitCommand({ engagement: "eng-1", homeDir: home });
  const keyPath = path.join(home, ".hexagen", "keys", "eng-1.key");
  const keyHex = (await readFile(keyPath, "utf-8")).trim();
  const grants = path.join(root, ".hexagen", "grants");
  await put(root, "g-expired.json", keyHex, {
    id: "g-expired",
    expires_at: "2026-10-01T11:00:00Z",
  });
  await put(root, "g-live.json", keyHex, { id: "g-live" });
  await put(root, "g-revoked.json", keyHex, {
    id: "g-revoked",
    revoked_at: "2026-10-01T10:00:00Z",
  });
  // `grant key init` prints the key path and fingerprint; only `list` output counts.
  out.length = 0;
  err.length = 0;
  return { root, home, keyHex, keyPath, grants };
}

function list(f: Fixture, extra: Partial<GrantListOptions> = {}) {
  return grantListCommand({
    workspaceRoot: f.root,
    homeDir: f.home,
    env: {},
    now: NOW,
    ...extra,
  });
}

const rows = (): GrantListRow[] =>
  JSON.parse(text()) as unknown as GrantListRow[];

describe("grant list (acceptance test 1: live, expired, revoked)", () => {
  it("lists all three grants with their window status and exits 0", async () => {
    const f = await fixture();
    await list(f);
    expect(process.exitCode).toBe(0);
    const t = text();
    expect(t).toContain("g-live");
    expect(t).toContain("g-expired");
    expect(t).toContain("g-revoked");
    expect(t).toMatch(/\blive\b/);
    expect(t).toMatch(/\bexpired\b/);
    expect(t).toMatch(/\brevoked\b/);
  });

  it("sorts by expires_at descending, then id", async () => {
    const f = await fixture();
    await list(f, { json: true });
    expect(rows().map((r) => r.id)).toEqual([
      "g-live",
      "g-revoked",
      "g-expired",
    ]);
  });

  it("prints the status per row against the injected time, and never the key", async () => {
    const f = await fixture();
    await list(f, { json: true });
    expect(rows().map((r) => [r.id, r.status])).toEqual([
      ["g-live", "live"],
      ["g-revoked", "revoked"],
      ["g-expired", "expired"],
    ]);
    // The window is evaluated at call time, and the time it was evaluated at is
    // printed with it (plan §4.2).
    expect(everything()).toContain("2026-10-01T12:00:00.000Z");
    expect(everything()).not.toContain(f.keyHex);
    expect(everything()).toMatch(/fingerprint [0-9a-f]{16}/);
  });

  it("says the listing is a snapshot, and that 'live' speaks about the window only", async () => {
    const f = await fixture();
    await list(f);
    const t = text();
    expect(t).toMatch(/snapshot/i);
    // The status column is the window alone: the signature has its own column,
    // and the footer must not read as though the status covered it.
    expect(t).toMatch(/"live" says only that the window/);
    expect(t).toMatch(/signature column/);
    expect(t).not.toMatch(/"live" says only that the signature/);
  });

  it("prints how many rows --status showed and what it hid", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.grants, "shape.json"),
      JSON.stringify({ id: "x" }),
    );
    await list(f, { status: "live" });
    // One row is printed, but the invalid entry and the failures it hides are
    // always visible in the summary.
    expect(text()).toContain(
      "1 shown (--status live); all 4 entries: 1 live, 1 expired, 1 revoked, 1 invalid",
    );
    expect(process.exitCode).toBe(1);
  });

  it("says 0 shown when the filter matches nothing, and still totals every row", async () => {
    const f = await fixture();
    await list(f, { status: "invalid" });
    expect(text()).toContain(
      "0 shown (--status invalid); all 3 entries: 1 live, 1 expired, 1 revoked, 0 invalid",
    );
  });

  it("prints the plain tally when no filter is given", async () => {
    const f = await fixture();
    await list(f);
    expect(text()).toContain(
      "3 entries: 1 live, 1 expired, 1 revoked, 0 invalid",
    );
    expect(text()).not.toContain("shown (--status");
  });

  it("shows mode, principal, agent and both timestamps", async () => {
    const f = await fixture();
    await list(f);
    const t = text();
    expect(t).toContain("martin");
    expect(t).toContain("lane-1");
    expect(t).toContain("propose");
    expect(t).toContain("2026-10-01T18:00:00Z");
    expect(t).toContain("2026-10-01T10:00:00Z");
    // The table mode names the key too, and only as a fingerprint.
    expect(t).toMatch(/fingerprint [0-9a-f]{16}/);
    expect(t).not.toContain(f.keyHex);
  });
});

describe("grant list (acceptance test 2: a hand-edited revoked_at)", () => {
  it("lists the signature failure and exits 1", async () => {
    const f = await fixture();
    const file = path.join(f.grants, "g-live.json");
    const raw = JSON.parse(await readFile(file, "utf-8")) as Record<
      string,
      unknown
    >;
    raw.revoked_at = "2026-10-01T10:00:00Z";
    await writeFile(file, JSON.stringify(raw, null, 2));
    await list(f);
    expect(process.exitCode).toBe(1);
    const t = text();
    expect(t).toContain("not verified");
    expect(t).not.toContain(f.keyHex);
  });

  it("reports it as a signature failure, not as a revoked grant", async () => {
    const f = await fixture();
    const file = path.join(f.grants, "g-live.json");
    const raw = JSON.parse(await readFile(file, "utf-8")) as Record<
      string,
      unknown
    >;
    raw.revoked_at = "2026-10-01T10:00:00Z";
    await writeFile(file, JSON.stringify(raw, null, 2));
    await list(f, { json: true });
    const row = rows().find((r) => r.id === "g-live");
    // The window still reads it as revoked; only the signature verdict differs.
    expect(row?.status).toBe("revoked");
    expect(row?.signature).toBe("not verified");
    expect(row?.reason).toMatch(/signature/);
  });
});

describe("grant list (acceptance test 3: a file that is not a grant)", () => {
  it("lists a non-JSON file as invalid and exits 1", async () => {
    const f = await fixture();
    await writeFile(path.join(f.grants, "notes.json"), "{not json\n");
    await list(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("notes.json");
    expect(text()).toMatch(/invalid: .*JSON/);
  });

  it("lists a file whose JSON is not a grant shape as invalid", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.grants, "shape.json"),
      JSON.stringify({ id: "x" }),
    );
    await list(f, { json: true });
    const row = rows().find((r) => r.file === "grants/shape.json");
    // The parse verdict verbatim: a shape failure is not a read failure, so it
    // must not be laundered into a generic "cannot be read" by the catch that
    // turns a raised fs error into a row.
    expect(row?.reason).toBe(
      "grants/shape.json is not a grant: principal: Required",
    );
  });

  it("lists a name the allow-list does not carry as invalid, not silently", async () => {
    const f = await fixture();
    await writeFile(path.join(f.grants, "notes.txt"), SECRET);
    await list(f, { json: true });
    const row = rows().find((r) => r.file === "grants/notes.txt");
    expect(row?.status).toBe("invalid");
    expect(row?.reason).toMatch(/not allow-listed/);
    expect(process.exitCode).toBe(1);
    expect(everything()).not.toContain(SECRET);
  });

  it("lists a key-shaped name as invalid without ever reading it", async () => {
    const f = await fixture();
    await writeFile(path.join(f.grants, "evil.key"), SECRET);
    await list(f, { json: true });
    const row = rows().find((r) => r.file === "grants/evil.key");
    expect(row?.status).toBe("invalid");
    expect(row?.reason).toMatch(/key or env file/);
    expect(everything()).not.toContain(SECRET);
  });

  it("one unreadable grant never hides the others", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.grants, "shape.json"),
      JSON.stringify({ id: "x" }),
    );
    await list(f, { json: true });
    expect(rows().filter((r) => r.status !== "invalid")).toHaveLength(3);
    expect(text()).toContain("g-live");
  });
});

describe("grant list (acceptance test 4: --status filters)", () => {
  it("--status revoked prints only the revoked rows", async () => {
    const f = await fixture();
    await list(f, { status: "revoked", json: true });
    expect(rows().map((r) => r.id)).toEqual(["g-revoked"]);
    expect(process.exitCode).toBe(0);
  });

  it("--status expired and --status live each filter", async () => {
    const f = await fixture();
    await list(f, { status: "expired", json: true });
    expect(rows().map((r) => r.id)).toEqual(["g-expired"]);
    expect(text()).not.toContain("g-live");
    process.exitCode = 99;
    out.length = 0;
    await list(f, { status: "live", json: true });
    expect(rows().map((r) => r.id)).toEqual(["g-live"]);
    expect(text()).not.toContain("g-revoked");
  });

  it("--status invalid shows only the invalid rows", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.grants, "shape.json"),
      JSON.stringify({ id: "x" }),
    );
    await list(f, { status: "invalid", json: true });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].status).toBe("invalid");
  });

  it("an unknown --status is bad input: exit 2, nothing printed", async () => {
    const f = await fixture();
    await list(f, { status: "stale" as GrantListOptions["status"] });
    expect(process.exitCode).toBe(2);
    expect(text()).not.toContain("g-live");
    expect(errors()).toMatch(/--status/);
  });
});

describe("grant list (acceptance test 5: nothing to list is exit 2)", () => {
  it("a missing .hexagen/grants/ exits 2", async () => {
    const f = await fixture();
    await rm(f.grants, { recursive: true, force: true });
    await list(f);
    expect(process.exitCode).toBe(2);
    expect(errors()).toContain("grants");
    expect(errors()).not.toContain(f.keyHex);
  });

  it("an absent .hexagen/ exits 2, and names observe rather than staging", async () => {
    const f = await fixture();
    await rm(path.join(f.root, ".hexagen"), {
      recursive: true,
      force: true,
    });
    await list(f);
    expect(process.exitCode).toBe(2);
    // The sidecar's own precondition is the diagnostic: telling an operator to
    // stage grants when there is no .hexagen/ at all sends them the wrong way.
    expect(errors()).toContain("hexagen observe");
    expect(errors()).not.toContain("nothing is staged");
  });

  it("a grants path that is not a directory exits 2 and reads nothing", async () => {
    const f = await fixture();
    await rm(f.grants, { recursive: true, force: true });
    await writeFile(f.grants, SECRET);
    await list(f);
    expect(process.exitCode).toBe(2);
    expect(everything()).not.toContain(SECRET);
  });

  it("a grant file over the enumerator's per-file cap is a row, not a failure", async () => {
    const f = await fixture();
    // The one readAllowed refusal a listing can actually reach: the shared
    // reader's 32 MiB cap. It must become an invalid row.
    await writeFile(
      path.join(f.grants, "huge.json"),
      Buffer.alloc(32 * 1024 * 1024 + 1, 32),
    );
    await list(f, { json: true });
    const row = rows().find((r) => r.file === "grants/huge.json");
    expect(row?.status).toBe("invalid");
    // The enumerator's own refusal, verbatim: no prefix, no rewording.
    expect(row?.reason).toBe("grants/huge.json: larger than 33554432 bytes");
    expect(rows().filter((r) => r.status !== "invalid")).toHaveLength(3);
    expect(process.exitCode).toBe(1);
  });

  it.skipIf(process.platform === "win32")(
    "a symlinked grants directory is refused, not followed out",
    async () => {
      const f = await fixture();
      const outside = await tmp("gl-outside-");
      await writeFile(path.join(outside, "leaked.json"), SECRET);
      await rm(f.grants, { recursive: true, force: true });
      await symlink(outside, f.grants);
      await list(f);
      expect(process.exitCode).toBe(2);
      expect(everything()).not.toContain(SECRET);
    },
  );

  it("an empty grants directory lists nothing read and exits 1", async () => {
    const f = await fixture();
    await rm(f.grants, { recursive: true, force: true });
    await mkdir(f.grants, { recursive: true });
    await list(f);
    expect(process.exitCode).toBe(1);
  });

  // Mode 000 does not stop root, so the case is skipped there. It is also skipped
  // on Windows, where the mode bits are not enforced on a directory: readdir
  // succeeds there and the call lists every grant instead of failing, which is
  // the platform's answer, not a defect in the command.
  const runsAsRoot = process.platform !== "win32" && process.getuid?.() === 0;
  it.skipIf(runsAsRoot || process.platform === "win32")(
    "an unreadable grants directory exits 2 rather than throwing",
    async () => {
      const f = await fixture();
      await chmod(f.grants, 0o000);
      try {
        await list(f);
        expect(process.exitCode).toBe(2);
        expect(errors()).toContain(f.grants);
      } finally {
        await chmod(f.grants, 0o700);
      }
    },
  );
});

describe("grant list: root discovery", () => {
  const cwd0 = process.cwd();
  afterEach(() => process.chdir(cwd0));

  it("a malformed ancestor package.json exits 2 with the message", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "package.json"), "{bad");
    process.chdir(f.root);
    await grantListCommand({ homeDir: f.home, env: {}, now: NOW });
    expect(process.exitCode).toBe(2);
    expect(errors()).toContain("Unreadable package.json");
  });
});

describe("grant list (acceptance test 6: a symlink is a row, never a read)", () => {
  it.skipIf(process.platform === "win32")(
    "is listed as `invalid: symlink`, gets its own row, and its target is never read",
    async () => {
      const f = await fixture();
      const target = path.join(f.root, "outside.json");
      await writeFile(target, SECRET);
      await symlink(target, path.join(f.grants, "link.json"));
      await list(f);
      expect(text()).toContain("invalid: symlink");
      expect(text()).toContain("link.json");
      expect(everything()).not.toContain(SECRET);
      expect(process.exitCode).toBe(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "a symlink pointing outside the sidecar is the same row, and the rest still lists",
    async () => {
      const f = await fixture();
      const outside = await tmp("gl-outside-");
      await writeFile(path.join(outside, "target.json"), SECRET);
      await symlink(
        path.join(outside, "target.json"),
        path.join(f.grants, "escape.json"),
      );
      await list(f, { json: true });
      const row = rows().find((r) => r.file === "grants/escape.json");
      expect(row).toEqual({
        file: "grants/escape.json",
        status: "invalid",
        signature: "invalid",
        reason: "symlink",
      });
      expect(rows().filter((r) => r.status !== "invalid")).toHaveLength(3);
      expect(everything()).not.toContain(SECRET);
    },
  );

  it.skipIf(process.platform === "win32")(
    "a directory entry named like a grant is invalid too, and is not read as one",
    async () => {
      const f = await fixture();
      await mkdir(path.join(f.grants, "adir.json"), { recursive: true });
      await list(f, { json: true });
      const row = rows().find((r) => r.file === "grants/adir.json");
      expect(row?.status).toBe("invalid");
      expect(row?.reason).toMatch(/not a regular file/);
      expect(process.exitCode).toBe(1);
    },
  );
});

describe("grant list (acceptance test 7: the boundary instants)", () => {
  const at = (iso: string): Date => new Date(iso);

  it("a call exactly at expires_at is live; one millisecond later is expired", async () => {
    const f = await fixture();
    await list(f, { now: at("2026-10-01T18:00:00.000Z"), json: true });
    expect(rows().find((r) => r.id === "g-live")?.status).toBe("live");
    process.exitCode = 99;
    out.length = 0;
    await list(f, { now: at("2026-10-01T18:00:00.001Z"), json: true });
    expect(rows().find((r) => r.id === "g-live")?.status).toBe("expired");
  });

  it("a call exactly at revoked_at is revoked", async () => {
    const f = await fixture();
    await list(f, { now: at("2026-10-01T10:00:00.000Z"), json: true });
    expect(rows().find((r) => r.id === "g-revoked")?.status).toBe("revoked");
  });

  it("one millisecond before revoked_at is still live", async () => {
    const f = await fixture();
    await list(f, { now: at("2026-10-01T09:59:59.999Z"), json: true });
    expect(rows().find((r) => r.id === "g-revoked")?.status).toBe("live");
  });
});

describe("grant list (acceptance test 8: a missing or weak key)", () => {
  it("every grant reports signature not verified, and the key is never printed", async () => {
    const f = await fixture();
    await rm(f.keyPath);
    await list(f);
    expect(process.exitCode).toBe(1);
    const t = text();
    expect((t.match(/not verified/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(t).not.toMatch(/(?<!not )verified/);
    expect(everything()).not.toContain(f.keyHex);
    // The missing key is named, so the failure is diagnosable.
    expect(everything()).toContain(f.keyPath);
  });

  it("a weak key exits 1 with the reason, never the key", async () => {
    const f = await fixture();
    await writeFile(f.keyPath, "abcd\n");
    await list(f);
    expect(process.exitCode).toBe(1);
    expect(text()).toContain("not verified");
    expect(everything()).toContain("64 hex");
    expect(everything()).not.toContain(f.keyHex);
  });

  it("with no key location at all every row is unverified, and the run still lists", async () => {
    const f = await fixture();
    await rm(f.keyPath);
    await rm(path.join(f.root, ".hexagen", "slice.json"));
    await list(f);
    expect(process.exitCode).toBe(1);
    expect((text().match(/not verified/g) ?? []).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(everything()).not.toContain(f.keyHex);
  });
});

describe("grant list (acceptance test 9: filtering does not hide a failure)", () => {
  it("--status live hides the hand-edited grant's row and still exits 1", async () => {
    const f = await fixture();
    const file = path.join(f.grants, "g-revoked.json");
    const raw = JSON.parse(await readFile(file, "utf-8")) as Record<
      string,
      unknown
    >;
    raw.revoked_at = "2026-10-01T11:30:00Z";
    await writeFile(file, JSON.stringify(raw, null, 2));
    await list(f, { status: "live", json: true });
    expect(rows().map((r) => r.id)).toEqual(["g-live"]);
    expect(process.exitCode).toBe(1);
  });

  it("an invalid entry the filter hides still exits 1", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.grants, "shape.json"),
      JSON.stringify({ id: "x" }),
    );
    await list(f, { status: "live", json: true });
    expect(rows().map((r) => r.id)).toEqual(["g-live"]);
    expect(process.exitCode).toBe(1);
  });
});

describe("grant list: --json", () => {
  it("prints one object per grant with the same fields, and the key line on stderr", async () => {
    const f = await fixture();
    await list(f, { json: true });
    const parsed = rows();
    expect(parsed).toHaveLength(3);
    expect(Object.keys(parsed[0]).sort()).toEqual([
      "agent",
      "expires_at",
      "file",
      "id",
      "mode",
      "principal",
      "signature",
      "status",
    ]);
    expect(errors()).toContain(f.keyPath);
    expect(text()).not.toContain(f.keyPath);
  });

  it("keeps revoked_at out of the JSON when the grant carries none", async () => {
    const f = await fixture();
    await list(f, { json: true });
    expect(
      Object.keys(rows().find((r) => r.id === "g-live") ?? {}),
    ).not.toContain("revoked_at");
  });

  it("a diagnostic consumer can read the whole stdout as JSON", async () => {
    const f = await fixture();
    await writeFile(path.join(f.grants, "notes.json"), "{not json\n");
    await list(f, { json: true });
    expect(() => rows()).not.toThrow();
  });

  it("writes the key line and the summary to stderr, so stdout stays the array", async () => {
    const f = await fixture();
    await list(f, { json: true, status: "revoked" });
    expect(rows()).toHaveLength(1);
    expect(errors()).toContain("1 shown (--status revoked)");
  });
});

describe("grant list: one entry that cannot be read does not stop the listing", () => {
  // `afterValidate` is the enumerator's own seam: it runs inside the guarded
  // read, after every check and before the bytes are read, so an error raised
  // there escapes `readAllowed` uncaught — which is exactly the shape of the
  // ENOENT a read can hit when an entry vanishes between its lstat and its
  // realpath. That race cannot be staged from a static fixture, so the seam
  // raises the same error codes instead.
  const failOn = (
    f: Fixture,
    name: string,
    code: string,
  ): ((file: string) => Promise<void>) => {
    const target = path.join(f.grants, name);
    return async (file) => {
      if (file !== target) return;
      throw Object.assign(new Error(`${code}: injected, simulated`), {
        code,
      });
    };
  };

  it.each(["ENOENT", "EACCES"])(
    "a %s raised while reading one entry becomes a row, and the rest still list",
    async (code) => {
      const f = await fixture();
      await list(f, {
        json: true,
        afterValidate: failOn(f, "g-live.json", code),
      });
      const listed = rows();
      expect(listed).toHaveLength(3);
      const broken = listed.find((r) => r.file === "grants/g-live.json");
      expect(broken?.status).toBe("invalid");
      expect(broken?.signature).toBe("invalid");
      expect(broken?.reason).toMatch(
        new RegExp(
          code === "ENOENT"
            ? "vanished before it could be read"
            : "permission denied",
        ),
      );
      expect(listed.filter((r) => r.status !== "invalid")).toHaveLength(2);
      expect(process.exitCode).toBe(1);
    },
  );

  it("never lets the error escape the call", async () => {
    const f = await fixture();
    await expect(
      list(f, {
        afterValidate: async () => {
          throw Object.assign(new Error("ELOOP: too many links"), {
            code: "ELOOP",
          });
        },
      }),
    ).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
  });
});

describe("grant list: the key is resolved once per listing", () => {
  it("resolves the key once for the listing, and reads it once per row", async () => {
    const f = await fixture();
    // `resolveGrantKey` and `readGrantKey` are both wrapped rather than spied
    // on: the shared module calls its own `readGrantKey` from inside
    // `resolveGrantKey`, so a wrapper on the export sees the resolutions and the
    // per-row reads and nothing in between. Resolving per row would make
    // `resolutions` 3.
    let resolutions = 0;
    let reads = 0;
    vi.resetModules();
    vi.doMock("@hexagen/shared/node/grant-key", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@hexagen/shared/node/grant-key")>();
      return {
        ...actual,
        resolveGrantKey: (
          ...args: Parameters<typeof actual.resolveGrantKey>
        ): ReturnType<typeof actual.resolveGrantKey> => {
          resolutions += 1;
          return actual.resolveGrantKey(...args);
        },
        readGrantKey: (keyPath: string) => {
          reads += 1;
          return actual.readGrantKey(keyPath);
        },
      };
    });
    try {
      const fresh = await import("../../../src/commands/grant/list.js");
      await fresh.grantListCommand({
        workspaceRoot: f.root,
        homeDir: f.home,
        env: {},
        now: NOW,
        json: true,
      });
    } finally {
      vi.doUnmock("@hexagen/shared/node/grant-key");
      vi.resetModules();
    }
    expect(resolutions).toBe(1);
    // One read per row for the HMAC it verifies: verify never caches key
    // material, so one per row is the floor, not a defect.
    expect(reads).toBe(3);
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.signature === "verified")).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});

describe("grant list: repo mode", () => {
  it("lists with the in-repo key and names it as the repo source", async () => {
    const root = await tmp("gl-root-");
    const home = await tmp("gl-home-");
    await mkdir(path.join(root, ".architecture"), { recursive: true });
    await writeFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "x: 1\n",
    );
    await mkdir(path.join(root, ".hexagen", "grants"), { recursive: true });
    const keyHex = "ab".repeat(32);
    const keyPath = path.join(root, ".hexagen", "grant-signing.key");
    await writeFile(keyPath, `${keyHex}\n`);
    await put(root, "g-1.json", keyHex, { id: "g-1" });
    await grantListCommand({
      workspaceRoot: root,
      homeDir: home,
      env: {},
      now: NOW,
      json: true,
    });
    expect(process.exitCode).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(errors()).toContain("[repo]");
    expect(everything()).not.toContain(keyHex);
  });
});

describe("grant list: the command line", () => {
  it("is registered on `hexagen grant` and reaches the command", async () => {
    const f = await fixture();
    // A failed assertion must not leave the key file in the environment for the
    // next test in this file.
    try {
      process.env.HEXAGEN_GRANT_KEY_FILE = f.keyPath;
      out.length = 0;
      vi.resetModules();
      const { grantCommander } =
        await import("../../../src/commands/grant/index.js");
      await grantCommander.parseAsync(
        ["list", "--workspace-root", f.root, "--status", "revoked", "--json"],
        { from: "user" },
      );
      expect(process.exitCode).toBe(0);
      expect(rows().map((r) => r.id)).toEqual(["g-revoked"]);
    } finally {
      delete process.env.HEXAGEN_GRANT_KEY_FILE;
    }
  });
});
