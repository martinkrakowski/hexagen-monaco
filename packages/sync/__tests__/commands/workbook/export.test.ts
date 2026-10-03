import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUNDLE_FORBIDDEN_PATH_PATTERN, BundleIndex } from "@hexagen/shared";
import {
  appendChainedLine,
  verifyBundleIndex,
} from "@hexagen/shared/node/trace-chain";
import { ensureExcluded } from "../../../src/commands/shared/git-exclude.js";
import { readZipStore } from "../../../src/commands/workbook/zip-read.js";
import { writeZipStore } from "../../../src/commands/report/zip-store.js";
import { runWorkbookExport } from "../../../src/commands/workbook/export.js";
import { runEvidencePack } from "../../../src/commands/evidence/pack.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import {
  cleanup,
  dirs,
  git,
  makeRepo,
  put,
  writeObserved,
} from "../slice/fixture.js";

const KEY = "ab".repeat(32);
const NOW = () => new Date("2026-10-02T00:00:00.000Z");

let root: string;
let keyFile: string;
let home: string;
const SECRET = "SECRET-MATERIAL-MUST-NOT-LEAK";

function signedGrant(): Record<string, unknown> {
  const g = {
    id: "grant-1",
    principal: "p",
    agent: "a",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: "2026-12-01T00:00:00.000Z",
  };
  return { ...g, signature: signGrantPayload(canonicalGrantPayload(g), KEY) };
}

const exists = (p: string): Promise<boolean> =>
  lstat(p).then(
    () => true,
    () => false,
  );

/** Reads the stored entries of a store-method zip. */
async function unzip(file: string): Promise<Map<string, string>> {
  const buf = await readFile(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const dataStart =
      localOff +
      30 +
      buf.readUInt16LE(localOff + 26) +
      buf.readUInt16LE(localOff + 28);
    out.set(name, buf.subarray(dataStart, dataStart + size).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

beforeEach(async () => {
  root = await makeRepo(["src/a.ts", "lib/b.ts"]);
  home = await mkdtemp(path.join(tmpdir(), "wb-home-"));
  dirs.push(home);
  keyFile = path.join(home, "engagement.key");
  await writeFile(keyFile, `${KEY}\n`);
  await writeObserved(root);
  await put(
    root,
    ".hexagen/slice.json",
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "eng-1",
      repo: { commit: git(root, "rev-parse", "HEAD") },
      paths: ["src/"],
      excludes: [],
      createdBy: "t@example.test",
      createdAt: "2026-10-01T00:00:00.000Z",
    }),
  );
  await put(
    root,
    ".hexagen/contract.json",
    JSON.stringify({
      schemaVersion: "1.0.0",
      sliceId: "eng-1",
      rules: [],
      knownViolations: [],
    }),
  );
  await put(
    root,
    ".hexagen/grants/grant-1.json",
    JSON.stringify(signedGrant()),
  );
  await put(
    root,
    ".hexagen/proposals/p1.patch",
    "diff --git a/src/a.ts b/src/a.ts\n",
  );
  await put(
    root,
    ".hexagen/proposals/p1.json",
    JSON.stringify({
      id: "p1",
      grantId: "grant-1",
      sliceId: "eng-1",
      tool: "hexagen_propose_patch",
      paths: ["src/a.ts"],
      traceSeq: 0,
      createdAt: "2026-10-01T10:00:00.000Z",
    }),
  );
  const trace = path.join(root, ".hexagen", "evidence", "trace.jsonl");
  await mkdir(path.dirname(trace), { recursive: true });
  await appendChainedLine(trace, (next) => ({
    grant_id: "grant-1",
    goal_id: "eng-1",
    tool_calls: [
      {
        name: "hexagen_propose_patch",
        args_digest: "sha256:aa",
        result_digest: "sha256:bb",
        time: "2026-10-01T10:00:00.000Z",
      },
    ],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: "2026-10-01T10:00:00.000Z",
    ended_at: "2026-10-01T10:00:00.000Z",
    ...next,
  }));
});
afterEach(cleanup);

const run = (over: Partial<Parameters<typeof runWorkbookExport>[0]> = {}) =>
  runWorkbookExport({
    root,
    out: ".hexagen/workbook.zip",
    keyFile,
    homeDir: home,
    now: NOW,
    ...over,
  });
const bundle = () => path.join(root, ".hexagen", "workbook.zip");

describe("workbook export, the bundle", () => {
  it("writes the allow-listed files, byte for byte, under an HMAC'd index", async () => {
    const r = await run();
    expect(r.exitCode).toBe(0);
    const zip = await unzip(bundle());
    const index = BundleIndex.parse(
      JSON.parse(zip.get("bundle.json") as string),
    );
    expect(index.sliceId).toBe("eng-1");
    expect(verifyBundleIndex(index as never, KEY)).toBe(true);
    expect(verifyBundleIndex(index as never, "cd".repeat(32))).toBe(false);
    const roles = Object.fromEntries(index.files.map((f) => [f.path, f.role]));
    expect(roles).toMatchObject({
      "observed.json": "observed",
      "slice.json": "slice",
      "contract.json": "contract",
      "grants/grant-1.json": "grant",
      "proposals/p1.patch": "proposal",
      "proposals/p1.json": "proposal",
      "evidence/trace.jsonl": "evidence",
      "evidence/verdicts.json": "evidence",
      "tip.json": "tip",
    });
    for (const rel of [
      "observed.json",
      "slice.json",
      "contract.json",
      "grants/grant-1.json",
      "proposals/p1.patch",
      "proposals/p1.json",
    ]) {
      expect(zip.get(rel)).toBe(
        await readFile(path.join(root, ".hexagen", rel), "utf8"),
      );
    }
    expect(JSON.parse(zip.get("tip.json") as string)).toEqual(
      JSON.parse(
        await readFile(path.join(root, ".hexagen/evidence/tip.json"), "utf8"),
      ),
    );
    // Every listed file exists in the zip, and nothing is unlisted.
    expect([...zip.keys()].filter((k) => k !== "bundle.json").sort()).toEqual(
      index.files.map((f) => f.path).sort(),
    );
    const forbidden = new RegExp(BUNDLE_FORBIDDEN_PATH_PATTERN);
    expect([...zip.keys()].some((k) => forbidden.test(k))).toBe(false);
    // The temporary pack is gone.
    expect(
      (await readdir(path.join(root, ".hexagen"))).filter(
        (n) => n.endsWith(".tmp") || n.includes("pack"),
      ),
    ).toEqual([]);
  });

  it("a tampered index fails its HMAC", async () => {
    await run();
    const zip = await unzip(bundle());
    const index = JSON.parse(zip.get("bundle.json") as string);
    index.sliceId = "other";
    expect(verifyBundleIndex(index, KEY)).toBe(false);
  });

  it("refuses a grant whose signature does not verify, writing nothing", async () => {
    const file = path.join(root, ".hexagen/grants/grant-1.json");
    const g = JSON.parse(await readFile(file, "utf8"));
    g.paths = ["src/", "lib/"];
    await writeFile(file, JSON.stringify(g));
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(await exists(bundle())).toBe(false);
  });

  it("requires a slice", async () => {
    await rm(path.join(root, ".hexagen/slice.json"));
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(await exists(bundle())).toBe(false);
  });
});

describe("workbook export and evidence pack, one set of rules", () => {
  const traceFile = (): string =>
    path.join(root, ".hexagen", "evidence", "trace.jsonl");

  /** `hexagen evidence pack` over this repo's own trace and grant. */
  const pack = () =>
    runEvidencePack({
      root,
      trace: traceFile(),
      grantFiles: [path.join(root, ".hexagen", "grants", "grant-1.json")],
      out: ".hexagen/parity.zip",
      keyFile,
      homeDir: home,
      now: NOW,
    });

  /** Widens nothing: moves the line's window off its own call (Rule 4). */
  const callOutsideOwnWindow = async (): Promise<void> => {
    const [only] = (await readFile(traceFile(), "utf8")).trimEnd().split("\n");
    const line = JSON.parse(only as string) as Record<string, unknown>;
    await put(
      root,
      ".hexagen/evidence/trace.jsonl",
      `${JSON.stringify({
        ...line,
        started_at: "2026-10-01T10:00:00.001Z",
        ended_at: "2026-10-01T10:00:01.000Z",
      })}\n`,
    );
  };

  it("the two live readers return the same reasons for the same line", async () => {
    await callOutsideOwnWindow();
    const direct = await pack();
    const viaExport = await run();
    expect(direct.exitCode).toBe(1);
    expect(viaExport.exitCode).toBe(1);
    expect(viaExport.messages).toEqual([
      "workbook export FAILED; no bundle written:",
      ...direct.messages,
    ]);
    expect(direct.messages.join("\n")).toMatch(
      /seq 0: Tool call 'hexagen_propose_patch' at 2026-10-01T10:00:00\.000Z is before started_at \(2026-10-01T10:00:00\.001Z\)/,
    );
    expect(await exists(bundle())).toBe(false);
    expect(await exists(path.join(root, ".hexagen", "parity.zip"))).toBe(false);
    expect(
      await exists(path.join(root, ".hexagen", "evidence", "tip.json")),
    ).toBe(false);
  });
});

describe("workbook export, fix round", () => {
  it("fails with exit 1 and writes nothing when the temp pack is tampered after it was verified", async () => {
    const r = await run({
      afterPack: async (zip: string) => {
        const buf = await readFile(zip);
        const at = buf.indexOf("grant_denied");
        const i = at >= 0 ? at : buf.indexOf("completed");
        buf[i] = buf[i] === 0x78 ? 0x79 : 0x78;
        await writeFile(zip, buf);
      },
    });
    expect(r.exitCode).toBe(1);
    expect(await exists(bundle())).toBe(false);
    expect(
      (await readdir(path.join(root, ".hexagen"))).filter((n) =>
        n.startsWith(".workbook-pack"),
      ),
    ).toEqual([]);
  });

  it("refuses with exit 2 when a trace exists but no verified grant does", async () => {
    await rm(path.join(root, ".hexagen/grants"), { recursive: true });
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toBe(
      "the trace exists but .hexagen/grants/ holds no verified grant; export cannot pack it",
    );
    expect(await exists(bundle())).toBe(false);
  });

  it("exits 1 for a shape-invalid grant", async () => {
    await put(root, ".hexagen/grants/bad.json", JSON.stringify({ id: "x" }));
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(await exists(bundle())).toBe(false);
  });

  it("reports ENOENT as the missing-slice hint only", async () => {
    await rm(path.join(root, ".hexagen/slice.json"));
    expect((await run()).messages.join("\n")).toMatch(/slice init/);
  });

  it.skipIf(process.platform === "win32")(
    "propagates the real cause for a symlinked slice",
    async () => {
      await rm(path.join(root, ".hexagen/slice.json"));
      await symlink(keyFile, path.join(root, ".hexagen/slice.json"));
      const r = await run();
      expect(r.exitCode).toBe(2);
      expect(r.messages.join("\n")).toMatch(/not a regular file/);
      expect(r.messages.join("\n")).not.toMatch(/slice init/);
    },
  );

  it("propagates the real cause for an oversized slice", async () => {
    await writeFile(
      path.join(root, ".hexagen/slice.json"),
      Buffer.alloc(33 * 1024 * 1024, 32),
    );
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/larger than/);
  });
});

describe("workbook export, round 3", () => {
  it.skipIf(process.platform === "win32")(
    "refuses a file swapped for a symlink after it was validated, and never reads the target",
    async () => {
      const secret = "SWAPPED-TARGET-CONTENT";
      const target = path.join(home, "target.json");
      await writeFile(target, secret);
      const r = await run({
        afterValidate: async (file: string) => {
          if (!file.endsWith("observed.json")) return;
          await rm(file);
          await symlink(target, file);
        },
      });
      expect(r.exitCode).toBe(2);
      expect(await exists(bundle())).toBe(false);
      expect(r.messages.join("\n")).not.toContain(secret);
    },
  );

  it("exits 1 when tip.json exists but the trace is missing", async () => {
    expect((await run({ out: ".hexagen/first.zip" })).exitCode).toBe(0);
    await rm(path.join(root, ".hexagen/evidence/trace.jsonl"));
    const r = await run();
    expect(r.exitCode).toBe(1);
    expect(r.messages.join("\n")).toContain(
      "evidence/tip.json exists but trace.jsonl is missing; the trace was removed or truncated",
    );
    expect(await exists(bundle())).toBe(false);
  });

  it("maps an unreadable temp pack to exit 1", async () => {
    const r = await run({
      afterPack: async (zip: string) => {
        await writeFile(zip, "not a zip");
      },
    });
    expect(r.exitCode).toBe(1);
    expect(r.messages.join("\n")).toContain("failed re-verification");
    expect(await exists(bundle())).toBe(false);
  });

  it("maps a temp pack missing an adopted entry to exit 1", async () => {
    const r = await run({
      afterPack: async (zip: string) => {
        const entries = readZipStore(await readFile(zip));
        entries.delete("evidence/verdicts.json");
        await writeFile(
          zip,
          writeZipStore(
            [...entries].map(([name, content]) => ({ name, content })),
          ),
        );
      },
    });
    expect(r.exitCode).toBe(1);
    expect(r.messages.join("\n")).toContain("failed re-verification");
    expect(await exists(bundle())).toBe(false);
  });
});

describe("workbook export, the allow-list", () => {
  it("never lists planted key files that sit outside the allow-listed names", async () => {
    await put(root, ".hexagen/grant-signing.key", SECRET);
    await put(root, ".hexagen/other.key", SECRET);
    await put(root, ".hexagen/keys/e.key", SECRET);
    await put(root, ".hexagen/.env.local", SECRET);
    expect((await run()).exitCode).toBe(0);
    const zip = await unzip(bundle());
    for (const [name, text] of zip) {
      expect(text, name).not.toContain(SECRET);
      expect(name).not.toMatch(/\.key$|keys\/|\.env/);
    }
  });

  it.each([
    ".hexagen/grants/evil.key",
    ".hexagen/proposals/evil.key",
    ".hexagen/grants/grant-signing.key",
    ".hexagen/proposals/.env.prod",
  ])(
    "refuses the export when %s is planted in a bundle directory",
    async (rel) => {
      await put(root, rel, SECRET);
      const r = await run();
      expect(r.exitCode).toBe(2);
      expect(r.messages.join("\n")).toMatch(/key|env|forbidden|refus/i);
      expect(await exists(bundle())).toBe(false);
    },
  );

  it("skips (with a note) a stray non-allow-listed file in a bundle directory", async () => {
    await put(root, ".hexagen/grants/notes.txt", SECRET);
    expect((await run()).exitCode).toBe(0);
    const zip = await unzip(bundle());
    expect([...zip.values()].some((t) => t.includes(SECRET))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlinked entry in a bundle directory",
    async () => {
      await symlink(
        path.join(home, "engagement.key"),
        path.join(root, ".hexagen/grants/link.json"),
      );
      const r = await run();
      expect(r.exitCode).toBe(2);
      expect(await exists(bundle())).toBe(false);
    },
  );
});

describe("workbook export, --out", () => {
  it.each([
    ["outside the sidecar", "bundle.zip"],
    ["above the root", "../bundle.zip"],
    ["under evidence/", ".hexagen/evidence/bundle.zip"],
    ["a key-named file", ".hexagen/bundle.key"],
    ["the sidecar itself", ".hexagen"],
    ["a directory form", ".hexagen/out/"],
  ])("refuses %s", async (_name, out) => {
    const r = await run({ out });
    expect(r.exitCode).toBe(2);
    expect(await exists(path.join(root, "bundle.zip"))).toBe(false);
    expect(await exists(bundle())).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "refuses an --out that resolves out of the sidecar through a symlink",
    async () => {
      const elsewhere = await mkdtemp(path.join(tmpdir(), "wb-else-"));
      dirs.push(elsewhere);
      await symlink(elsewhere, path.join(root, ".hexagen/link"));
      const r = await run({ out: ".hexagen/link/b.zip" });
      expect(r.exitCode).toBe(2);
      expect(await readdir(elsewhere)).toEqual([]);
    },
  );

  it("never overwrites an existing file", async () => {
    await put(root, ".hexagen/workbook.zip", "precious");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(await readFile(bundle(), "utf8")).toBe("precious");
  });

  it("requires --out or --stage", async () => {
    const r = await run({ out: undefined });
    expect(r.exitCode).toBe(2);
  });
});

describe("workbook export --stage", () => {
  const cached = (): string => git(root, "diff", "--cached", "--name-only");

  it("prints the diff and stages nothing without --yes", async () => {
    const r = await run({
      out: undefined,
      stage: [".hexagen/slice.json", ".hexagen/grants/grant-1.json"],
    });
    expect(r.exitCode).toBe(0);
    const text = r.messages.join("\n");
    expect(text).toContain("+++ b/.hexagen/slice.json");
    expect(text).toContain("+++ b/.hexagen/grants/grant-1.json");
    expect(text).toContain("eng-1");
    expect(cached()).toBe("");
    expect(r.staged ?? []).toEqual([]);
  });

  it("stages exactly the named files, with git add -f, on --yes", async () => {
    await ensureExcluded(root, ".hexagen/");
    expect(git(root, "status", "--porcelain")).toBe("");
    const r = await run({
      out: undefined,
      stage: [".hexagen/slice.json", ".hexagen/proposals/p1.patch"],
      yes: true,
    });
    expect(r.exitCode).toBe(0);
    expect(cached().split("\n").sort()).toEqual([
      ".hexagen/proposals/p1.patch",
      ".hexagen/slice.json",
    ]);
    expect([...(r.staged ?? [])].sort()).toEqual([
      ".hexagen/proposals/p1.patch",
      ".hexagen/slice.json",
    ]);
  });

  it("stages exactly the previewed bytes when the file changes before staging", async () => {
    await ensureExcluded(root, ".hexagen/");
    const file = path.join(root, ".hexagen/slice.json");
    const previewed = await readFile(file);
    const r = await run({
      out: undefined,
      stage: [".hexagen/slice.json"],
      yes: true,
      beforeStage: async () => {
        await writeFile(file, "CHANGED AFTER PREVIEW\n");
      },
    });
    expect(r.exitCode).toBe(0);
    expect(cached()).toBe(".hexagen/slice.json");
    const blob = execFileSync("git", ["show", ":.hexagen/slice.json"], {
      cwd: root,
    });
    expect(blob.equals(previewed)).toBe(true);
  });

  it("previews a tracked file against HEAD, including changes already in the index", async () => {
    const file = path.join(root, ".hexagen/slice.json");
    git(root, "add", "-f", ".hexagen/slice.json");
    git(root, "commit", "-q", "-m", "track slice");
    const base = await readFile(file, "utf8");
    await writeFile(file, base.replace("eng-1", "ENG-STAGED"));
    git(root, "add", "-f", ".hexagen/slice.json");
    await writeFile(file, base.replace("eng-1", "ENG-WORKTREE"));
    const r = await run({ out: undefined, stage: [".hexagen/slice.json"] });
    expect(r.exitCode).toBe(0);
    const text = r.messages.join("\n");
    expect(text).toContain("ENG-WORKTREE");
    expect(text).toContain("eng-1");
    // the staged-only spelling is not what will be staged, so it is not shown as the result
    expect(text).not.toContain("+++ /dev/null");
  });

  it("previews and stages the same pinned bytes when the file changes after it was read", async () => {
    const file = path.join(root, ".hexagen/slice.json");
    git(root, "add", "-f", ".hexagen/slice.json");
    git(root, "commit", "-q", "-m", "track slice");
    const base = await readFile(file, "utf8");
    await writeFile(file, base.replace("eng-1", "ENG-PINNED"));
    const pinned = await readFile(file);
    const r = await run({
      out: undefined,
      stage: [".hexagen/slice.json"],
      yes: true,
      beforePreview: async () => {
        await writeFile(file, base.replace("eng-1", "CHANGED-AFTER-READ"));
      },
    });
    expect(r.exitCode).toBe(0);
    const text = r.messages.join("\n");
    expect(text).toContain("+++ b/.hexagen/slice.json");
    expect(text).toContain("ENG-PINNED");
    expect(text).not.toContain("CHANGED-AFTER-READ");
    const blob = execFileSync("git", ["show", ":.hexagen/slice.json"], {
      cwd: root,
    });
    expect(blob.equals(pinned)).toBe(true);
  });

  it("accepts an absolute path inside the root", async () => {
    const r = await run({
      out: undefined,
      stage: [path.join(root, ".hexagen/slice.json")],
      yes: true,
    });
    expect(r.exitCode).toBe(0);
    expect(cached()).toBe(".hexagen/slice.json");
  });

  it.each([
    ".hexagen/grant-signing.key",
    ".hexagen/other.key",
    ".hexagen/grants/evil.key",
    ".hexagen/keys/e.key",
    ".hexagen/.env",
    ".hexagen/evidence/verdicts.json",
    ".hexagen/notes.txt",
    "src/a.ts",
    "../outside.json",
    ".hexagen/grants/../../src/a.ts",
  ])("refuses %s, staging nothing even beside a good file", async (bad) => {
    await put(root, ".hexagen/grant-signing.key", SECRET);
    await put(root, ".hexagen/other.key", SECRET);
    await put(root, ".hexagen/grants/evil.key", SECRET);
    await put(root, ".hexagen/keys/e.key", SECRET);
    await put(root, ".hexagen/.env", SECRET);
    await put(root, ".hexagen/notes.txt", "n");
    const r = await run({
      out: undefined,
      stage: [".hexagen/slice.json", bad],
      yes: true,
    });
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).not.toContain(SECRET);
    expect(cached()).toBe("");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a symlink and a key reached through the home keys directory",
    async () => {
      await mkdir(path.join(home, ".hexagen/keys"), { recursive: true });
      await writeFile(path.join(home, ".hexagen/keys/e.key"), SECRET);
      await symlink(
        path.join(home, ".hexagen/keys/e.key"),
        path.join(root, ".hexagen/grants/link.json"),
      );
      const r = await run({
        out: undefined,
        stage: [".hexagen/grants/link.json"],
        yes: true,
      });
      expect(r.exitCode).toBe(2);
      expect(cached()).toBe("");
    },
  );

  it("does not touch the working tree", async () => {
    const before = await stat(path.join(root, "src/a.ts"));
    await run({ out: undefined, stage: [".hexagen/slice.json"], yes: true });
    expect((await stat(path.join(root, "src/a.ts"))).mtimeMs).toBe(
      before.mtimeMs,
    );
  });
});
