/**
 * Brownfield workbook, end to end, with no web app (plan §6 items 4 and 5).
 *
 * A synthetic client repo is cloned, and every step runs through the REAL
 * built CLI (`packages/sync/dist/cli.js`, spawned as a child process) or a
 * real MCP client over stdio against the mcp-server (the built
 * `dist/cli.js`, or its source through tsx when no build exists):
 *
 *   git clone, observe, slice init, contract propose/add-rule/check,
 *   grant key init/issue/show/check, hexagen_propose_patch (one allowed patch
 *   and one outside the slice), evidence pack, workbook export.
 *
 * Then: the client tree is byte-identical apart from `.hexagen/` and the git
 * exclude file, no generator command ran, the out-of-slice denial is in the
 * pack's `denials`, and the bundle's HMAC verifies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BundleIndex } from "@hexagen/shared";
import { verifyBundleIndex } from "@hexagen/shared/node/trace-chain";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "../..");
const syncCli = path.resolve(mcpDir, "../sync/dist/cli.js");
const mcpDist = path.join(mcpDir, "dist/cli.js");

const GIT = ["-c", "user.email=t@example.test", "-c", "user.name=t"];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...GIT, ...args], {
    cwd,
    encoding: "utf8",
    // Hermetic, read at call time: a developer's gpgsign, hooks or aliases never apply.
    env: {
      ...process.env,
      HOME: work,
      GIT_CONFIG_GLOBAL: path.join(work, "empty.gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();

let work: string;
let clone: string;
let keyFile: string;
let env: NodeJS.ProcessEnv;
const log: string[] = [];

function cli(args: string[], expectCode = 0): { out: string; code: number } {
  const r = spawnSync(process.execPath, [syncCli, ...args], {
    cwd: clone,
    env,
    encoding: "utf8",
  });
  const out = `${r.stdout}${r.stderr}`;
  log.push(`$ hexagen ${args.join(" ")}\n${out}`);
  expect(r.status, `hexagen ${args.join(" ")}\n${out}`).toBe(expectCode);
  return { out, code: r.status ?? -1 };
}

/** path -> hash of every file in the clone, `.git` included, except `.hexagen/` and `.git/info/exclude`. */
async function hashTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (rel: string): Promise<void> => {
    const abs = path.join(dir, rel);
    for (const name of (await readdir(abs)).sort()) {
      const r = rel === "" ? name : `${rel}/${name}`;
      if (r === ".hexagen" || r === ".git/info/exclude") continue;
      const st = await lstat(path.join(dir, r));
      if (st.isDirectory()) {
        out.set(`${r}/`, "dir");
        await walk(r);
      } else if (st.isSymbolicLink()) {
        out.set(r, `link:${await readlink(path.join(dir, r))}`);
      } else {
        out.set(
          r,
          createHash("sha256")
            .update(await readFile(path.join(dir, r)))
            .digest("hex"),
        );
      }
    }
  };
  await walk("");
  return out;
}

/** Entries of a store-method zip (what `hexagen evidence pack` and `workbook export` write). */
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

const put = async (root: string, rel: string, text: string): Promise<void> => {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
};

const ALLOWED_PATCH = `diff --git a/packages/app/src/index.ts b/packages/app/src/index.ts
--- a/packages/app/src/index.ts
+++ b/packages/app/src/index.ts
@@ -1,2 +1,2 @@
 import { x } from "../../lib/src/x";
-export const y = x + 1;
+export const y = x + 2;
`;
const OUT_OF_SLICE_PATCH = `diff --git a/packages/lib/src/x.ts b/packages/lib/src/x.ts
--- a/packages/lib/src/x.ts
+++ b/packages/lib/src/x.ts
@@ -1 +1 @@
-export const x = 1;
+export const x = 2;
`;

beforeAll(async () => {
  expect(
    existsSync(syncCli),
    `${syncCli} is missing: build @hexagen/sync first (turbo does, via ^build)`,
  ).toBe(true);
  work = await mkdtemp(path.join(tmpdir(), "bf-e2e-"));
  await writeFile(path.join(work, "empty.gitconfig"), "");
  const upstream = path.join(work, "upstream");
  clone = path.join(work, "clone");
  keyFile = path.join(work, "keys", "eng-e2e.key");
  await put(
    upstream,
    "package.json",
    '{"private":true,"workspaces":["packages/*"]}\n',
  );
  await put(
    upstream,
    "packages/app/package.json",
    '{"name":"@acme/app","version":"1.0.0"}\n',
  );
  await put(
    upstream,
    "packages/lib/package.json",
    '{"name":"@acme/lib","version":"1.0.0"}\n',
  );
  await put(
    upstream,
    "packages/app/src/index.ts",
    'import { x } from "../../lib/src/x";\nexport const y = x + 1;\n',
  );
  await put(upstream, "packages/lib/src/x.ts", "export const x = 1;\n");
  git(upstream, "init", "-q");
  git(upstream, "add", "package.json", "packages");
  git(upstream, "commit", "-q", "-m", "init");
  git(work, "clone", "-q", upstream, clone);
  env = {
    ...process.env,
    HEXAGEN_GRANT_KEY_FILE: keyFile,
    // The keys never live in the client repo, and no real home is touched.
    HOME: work,
  };
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("brownfield workbook, end to end with no web app", () => {
  it("drives the whole sequence and leaves the client tree untouched", async () => {
    const before = await hashTree(clone);
    expect(before.size).toBeGreaterThan(5);

    // observe
    cli(["observe", "--out", ".hexagen/observed.json", "--yes"]);
    const observed = JSON.parse(
      await readFile(path.join(clone, ".hexagen/observed.json"), "utf8"),
    );
    expect(
      observed.packages.items.map((p: { name: string }) => p.name),
    ).toEqual(expect.arrayContaining(["@acme/app", "@acme/lib"]));

    // slice, contract
    cli([
      "slice",
      "init",
      "--path",
      "packages/app/",
      "--id",
      "eng-e2e",
      "--by",
      "t@example.test",
      "--yes",
    ]);
    cli(["contract", "propose"]);
    cli([
      "contract",
      "add-rule",
      "--kind",
      "forbid",
      "--from",
      "packages/app/",
      "--to",
      "packages/other/",
      "--id",
      "no-other",
      "--yes",
    ]);
    cli(["contract", "check"]);

    // grant
    cli([
      "grant",
      "key",
      "init",
      "--engagement",
      "eng-e2e",
      "--key-file",
      keyFile,
    ]);
    cli([
      "grant",
      "issue",
      "--principal",
      "fde",
      "--agent",
      "agent-1",
      "--paths",
      "packages/app/",
      "--tools",
      "hexagen_propose_patch",
      "--mode",
      "propose",
      "--expires-in",
      "1h",
      "--out",
      ".hexagen/grants/g1.json",
      "--yes",
    ]);
    cli(["grant", "show", ".hexagen/grants/g1.json"]);
    cli([
      "grant",
      "check",
      ".hexagen/grants/g1.json",
      "--tool",
      "hexagen_propose_patch",
      "--path",
      "packages/app/src/index.ts",
    ]);
    cli(
      [
        "grant",
        "check",
        ".hexagen/grants/g1.json",
        "--tool",
        "hexagen_propose_patch",
        "--path",
        "packages/lib/src/x.ts",
      ],
      1,
    );

    // hexagen_propose_patch through a local MCP client over stdio
    const grant = JSON.parse(
      await readFile(path.join(clone, ".hexagen/grants/g1.json"), "utf8"),
    );
    const useDist = existsSync(mcpDist);
    if (!useDist) {
      process.stderr.write(
        "[e2e] packages/mcp-server/dist/cli.js is missing: running the mcp-server from source through tsx\n",
      );
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: useDist
        ? [mcpDist, "--workspace-root", clone]
        : [
            "--import",
            "tsx",
            path.join(mcpDir, "src/cli.ts"),
            "--workspace-root",
            clone,
          ],
      cwd: mcpDir,
      env: env as Record<string, string>,
      stderr: "ignore",
    });
    const client = new Client({ name: "bf-e2e", version: "0.0.0" });
    let allowed: { isError?: boolean; text: string };
    let denied: { isError?: boolean; text: string };
    try {
      await client.connect(transport);
      const call = async (patch: string) => {
        const r = (await client.callTool({
          name: "hexagen_propose_patch",
          arguments: { patch, grant },
        })) as { isError?: boolean; content: Array<{ text: string }> };
        return { isError: r.isError, text: r.content[0]?.text ?? "" };
      };
      allowed = await call(ALLOWED_PATCH);
      denied = await call(OUT_OF_SLICE_PATCH);
    } finally {
      await client.close();
    }
    expect(allowed.isError).toBeFalsy();
    expect(JSON.parse(allowed.text).allowed).toBe(true);
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.text).allowed).toBe(false);
    const proposals = await readdir(path.join(clone, ".hexagen/proposals"));
    expect(proposals.filter((n) => n.endsWith(".patch"))).toHaveLength(1);

    // the trace: one evidence line, one denial
    const trace = (
      await readFile(path.join(clone, ".hexagen/evidence/trace.jsonl"), "utf8")
    )
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(trace).toHaveLength(2);
    expect(trace.map((l) => l.halt_reason)).toEqual([
      "completed",
      "grant_denied",
    ]);
    expect(trace.every((l) => l.goal_id === "eng-e2e")).toBe(true);

    // evidence pack
    cli([
      "evidence",
      "pack",
      ".hexagen/evidence/trace.jsonl",
      "--grant",
      ".hexagen/grants/g1.json",
      "--out",
      ".hexagen/evidence-pack.zip",
    ]);
    const pack = await unzip(path.join(clone, ".hexagen/evidence-pack.zip"));
    const packVerdicts = JSON.parse(
      pack.get("evidence/verdicts.json") as string,
    );
    expect(packVerdicts.denials).toHaveLength(1);
    expect(packVerdicts.denials[0]).toMatchObject({
      seq: 1,
      haltReason: "grant_denied",
      tool: "hexagen_propose_patch",
    });
    expect(packVerdicts.evidence.count).toBe(1);

    // workbook export
    cli(["workbook", "export", "--out", ".hexagen/workbook.zip"]);
    const bundle = await unzip(path.join(clone, ".hexagen/workbook.zip"));
    const index = BundleIndex.parse(
      JSON.parse(bundle.get("bundle.json") as string),
    );
    const keyHex = (await readFile(keyFile, "utf8")).trim();
    expect(verifyBundleIndex(index as never, keyHex)).toBe(true);
    expect(index.sliceId).toBe("eng-e2e");
    expect(new Set(index.files.map((f) => f.role))).toEqual(
      new Set([
        "observed",
        "slice",
        "contract",
        "grant",
        "proposal",
        "evidence",
        "tip",
      ]),
    );
    const bundleVerdicts = JSON.parse(
      bundle.get("evidence/verdicts.json") as string,
    );
    expect(bundleVerdicts.denials).toHaveLength(1);
    expect(bundleVerdicts.denials[0].haltReason).toBe("grant_denied");
    for (const name of bundle.keys())
      expect(name).not.toMatch(/\.key$|keys\/|\.env/);
    expect([...bundle.values()].some((t) => t.includes(keyHex))).toBe(false);

    // §6 item 5: the client tree is byte-identical apart from .hexagen/ and info/exclude
    const after = await hashTree(clone);
    expect([...after.entries()]).toEqual([...before.entries()]);
    // ... and no generator command left its output behind
    for (const generated of [
      ".architecture",
      "layout.yaml",
      "manifest.yaml",
      "generator.config.yaml",
    ]) {
      expect(existsSync(path.join(clone, generated)), generated).toBe(false);
    }
    expect(log.join("\n")).not.toMatch(
      /\b(adopt|bootstrap)\b|hexagen sync|layout\.yaml/i,
    );
    // the sidecar stays out of `git status`
    expect(git(clone, "status", "--porcelain")).toBe("");
  }, 120_000);

  it("(a) a planted root grant-signing.key is never exported", async () => {
    const secret = "9f".repeat(32);
    await put(clone, ".hexagen/grant-signing.key", secret);
    const r = cli(["workbook", "export", "--out", ".hexagen/key-a.zip"]);
    expect(r.code).toBe(0);
    const entries = await unzip(path.join(clone, ".hexagen/key-a.zip"));
    for (const [name, text] of entries) {
      expect(name).not.toMatch(/\.key$|keys\/|\.env/);
      expect(text, name).not.toContain(secret);
    }
    await rm(path.join(clone, ".hexagen/grant-signing.key"));
  }, 60_000);

  it("(b) a planted grants/planted.key refuses the export and writes no zip", async () => {
    await put(clone, ".hexagen/grants/planted.key", "x".repeat(64));
    const refused = cli(
      ["workbook", "export", "--out", ".hexagen/key-b.zip"],
      2,
    );
    expect(refused.out).toMatch(/key/i);
    expect(existsSync(path.join(clone, ".hexagen/key-b.zip"))).toBe(false);
    await rm(path.join(clone, ".hexagen/grants/planted.key"));
  }, 60_000);

  it("(c) --stage of grant-signing.key refuses and stages nothing", async () => {
    await put(clone, ".hexagen/grant-signing.key", "x".repeat(64));
    cli(
      ["workbook", "export", "--stage", ".hexagen/grant-signing.key", "--yes"],
      2,
    );
    expect(git(clone, "diff", "--cached", "--name-only")).toBe("");
    await rm(path.join(clone, ".hexagen/grant-signing.key"));
  }, 60_000);
});
