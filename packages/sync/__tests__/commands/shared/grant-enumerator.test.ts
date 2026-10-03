import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  listDir,
  openSidecar,
  readAllowed,
  Refusal,
  type Sidecar,
} from "../../../src/commands/shared/grant-enumerator.js";
import {
  allowListEntry,
  type AllowedFile,
} from "../../../src/commands/workbook/allow-list.js";

/**
 * The grants enumerator that `workbook export` used to hold inline (plan 4,
 * lane 4A): the sidecar opener, the one guarded read, and the directory walk.
 * Every verdict asserted here is the export's. This suite is the extraction's
 * behaviour lock, because the shared module now has a second caller and a
 * change to it moves `hexagen workbook export` as well (plan §7, acceptance
 * test 10).
 */

const MAX_BYTES = 32 * 1024 * 1024;
const SECRET = "SECRET-MATERIAL-MUST-NOT-LEAK";

const dirs: string[] = [];
let root: string;
let home: string;

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** Writes `rel` under `base`, creating the directories, and returns the path. */
async function put(base: string, rel: string, text: string): Promise<string> {
  const file = path.join(base, ...rel.split("/"));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

beforeEach(async () => {
  // The enumerator never searches upward and never runs git, so a plain
  // directory is the whole fixture: `<root>/.hexagen/` plus a home.
  root = await temp("ge-root-");
  home = await temp("ge-home-");
  await put(root, ".hexagen/grants/grant-1.json", '{"id":"grant-1"}\n');
  await put(root, ".hexagen/proposals/p1.patch", "diff --git a b\n");
});
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

/** The sidecar, opened the way `workbook export` opens it. */
const open = (r: string = root, h: string = home) => openSidecar(r, h);

/**
 * The allow-list entry for `source`, or a hand-made one when the allow-list
 * refuses the name. The guards run on the entry they are handed, so a guard
 * the allow-list would otherwise hide stays reachable here.
 */
function entry(source: string): AllowedFile {
  return (
    allowListEntry(source) ?? { source, bundlePath: source, role: "grant" }
  );
}

/** The refusal `readAllowed` throws, as a message and an exit code. */
async function refused(
  sc: Sidecar,
  source: string,
): Promise<{ message: string; exitCode: number }> {
  const error = await readAllowed(sc, entry(source)).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `${source} was read; it must be refused`).toBeInstanceOf(
    Refusal,
  );
  const thrown = error as Refusal;
  return { message: thrown.message, exitCode: thrown.exitCode };
}

describe("openSidecar", () => {
  it("records the sidecar, its real path and the home keys directory", async () => {
    const sc = await open();
    expect(sc.root).toBe(root);
    expect(sc.dir).toBe(path.join(root, ".hexagen"));
    expect(sc.real).toBe(await realpath(path.join(root, ".hexagen")));
    expect(sc.homeKeys).toBe(path.join(await realpath(home), ".hexagen/keys"));
  });

  it("resolves the sidecar through a symlink, and keeps the keys directory real", async () => {
    await mkdir(path.join(root, "real-sidecar"), { recursive: true });
    await rm(path.join(root, ".hexagen"), { recursive: true, force: true });
    await symlink(path.join(root, "real-sidecar"), path.join(root, ".hexagen"));
    const sc = await open();
    expect(sc.real).toBe(await realpath(path.join(root, "real-sidecar")));
    expect(sc.homeKeys).toBe(path.join(await realpath(home), ".hexagen/keys"));
  });

  it("refuses a sidecar that does not exist, and names the command that makes one", async () => {
    await rm(path.join(root, ".hexagen"), { recursive: true, force: true });
    const error = await open().then(
      () => null,
      (e: unknown) => e as Refusal,
    );
    expect(error).toBeInstanceOf(Refusal);
    expect(error?.message).toBe(
      `${path.join(root, ".hexagen")} does not exist; run \`hexagen observe\` first`,
    );
    expect(error?.exitCode).toBe(2);
  });

  it("passes the afterValidate seam through to every read", async () => {
    const seen: string[] = [];
    const sc = await openSidecar(root, home, async (file) => {
      seen.push(file);
    });
    await readAllowed(sc, entry("grants/grant-1.json"));
    expect(seen).toEqual([path.join(root, ".hexagen/grants/grant-1.json")]);
  });
});

describe("listDir", () => {
  it("lists the names in a sidecar subdirectory, sorted", async () => {
    await put(root, ".hexagen/grants/b.json", "{}\n");
    await put(root, ".hexagen/grants/a.json", "{}\n");
    expect(await listDir(await open(), "grants")).toEqual([
      "a.json",
      "b.json",
      "grant-1.json",
    ]);
    expect(await listDir(await open(), "proposals")).toEqual(["p1.patch"]);
  });

  it("is empty for a directory that does not exist", async () => {
    expect(await listDir(await open(), "keys")).toEqual([]);
  });

  it("propagates a readdir failure that is not a missing directory", async () => {
    await put(root, ".hexagen/evidence/trace.jsonl", "{}\n");
    const code = await listDir(await open(), "evidence/trace.jsonl").then(
      () => "resolved",
      (e: unknown) => (e as NodeJS.ErrnoException).code ?? "no code",
    );
    expect(code).toBe("ENOTDIR");
  });
});

describe("readAllowed", () => {
  it("reads an allow-listed file byte for byte", async () => {
    const read = await readAllowed(await open(), entry("grants/grant-1.json"));
    expect(read.text.toString("utf8")).toBe('{"id":"grant-1"}\n');
    expect(read.file).toBe(path.join(root, ".hexagen/grants/grant-1.json"));
  });

  it.each([
    "grants/evil.key",
    "proposals/.env.prod",
    "keys/e.key",
    "grant-signing.key",
  ])("refuses %s on the spelling of the path", async (source) => {
    await put(root, `.hexagen/${source}`, SECRET);
    expect(await refused(await open(), source)).toEqual({
      message: `${source}: names a key or env file; refusing`,
      exitCode: 2,
    });
  });

  it("refuses a file that does not exist", async () => {
    expect(await refused(await open(), "grants/absent.json")).toEqual({
      message: "grants/absent.json: does not exist",
      exitCode: 2,
    });
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlink, and never names its target",
    async () => {
      const target = await put(home, "target.json", SECRET);
      await symlink(target, path.join(root, ".hexagen/grants/link.json"));
      const { message } = await refused(await open(), "grants/link.json");
      expect(message).toBe(
        "grants/link.json: is not a regular file (symlinks are refused)",
      );
      expect(message).not.toContain(SECRET);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a path that resolves outside the sidecar",
    async () => {
      const outside = await temp("ge-outside-");
      await put(outside, "evil.json", SECRET);
      await symlink(outside, path.join(root, ".hexagen/link"));
      const sc = await open();
      const { message } = await refused(sc, "link/evil.json");
      expect(message).toBe(`link/evil.json: resolves outside ${sc.real}`);
      expect(message).not.toContain(SECRET);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a key reached through the home keys directory",
    async () => {
      // The client repo IS the home directory, so its sidecar sits under
      // ~/.hexagen/keys. A `keys` segment on the written spelling is refused
      // by an earlier check, so the same file is reached through a link that
      // is not spelled `keys`.
      const asHome = await temp("ge-home-repo-");
      await put(asHome, ".hexagen/keys/e.json", SECRET);
      await symlink(
        path.join(asHome, ".hexagen/keys"),
        path.join(asHome, ".hexagen/sub"),
      );
      const { message } = await refused(
        await open(asHome, asHome),
        "sub/e.json",
      );
      expect(message).toBe(
        "sub/e.json: resolves into ~/.hexagen/keys; refusing",
      );
      expect(message).not.toContain(SECRET);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a path that resolves to a key file under another name",
    async () => {
      await put(root, ".hexagen/keys/e.json", SECRET);
      await symlink(
        path.join(root, ".hexagen/keys"),
        path.join(root, ".hexagen/sub"),
      );
      const { message } = await refused(await open(), "sub/e.json");
      expect(message).toBe(
        "sub/e.json: resolves to a key or env file; refusing",
      );
      expect(message).not.toContain(SECRET);
    },
  );

  it("refuses a file over the per-file cap", async () => {
    await writeFile(
      path.join(root, ".hexagen/grants/big.json"),
      Buffer.alloc(MAX_BYTES + 1, 32),
    );
    expect(await refused(await open(), "grants/big.json")).toEqual({
      message: `grants/big.json: larger than ${MAX_BYTES} bytes`,
      exitCode: 2,
    });
  });

  it.skipIf(process.platform === "win32")(
    "refuses a file swapped for a symlink after it was validated",
    async () => {
      const target = await put(home, "target.json", SECRET);
      const file = path.join(root, ".hexagen/grants/grant-1.json");
      const sc = await openSidecar(root, home, async (f) => {
        if (f !== file) return;
        await rm(f);
        await symlink(target, f);
      });
      const { message } = await refused(sc, "grants/grant-1.json");
      expect(message).toBe(
        "grants/grant-1.json: is not a regular file (symlinks are refused)",
      );
      expect(message).not.toContain(SECRET);
    },
  );
});

describe("Refusal", () => {
  it("defaults to exit 2, and carries an exit 1 when the caller asks for it", () => {
    expect(new Refusal("nope")).toBeInstanceOf(Error);
    expect(new Refusal("nope").message).toBe("nope");
    expect(new Refusal("nope").exitCode).toBe(2);
    expect(new Refusal("bad grant", 1).exitCode).toBe(1);
  });
});
