import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENESIS_PREV_HASH,
  TraceChainError,
  appendChainedLine,
  canonicalJson,
  lineHash,
  signBundleIndex,
  signTip,
  splitTrace,
  verifyBundleIndex,
  verifyTip,
} from "../../src/node/trace-chain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..", "..");
const KEY = "ab".repeat(32);

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "trace-chain-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function readLines(file: string): Promise<Record<string, unknown>[]> {
  return (await readFile(file, "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("canonicalJson / lineHash", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } }),
    ).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });
  it("hash covers the line's own prev_hash", () => {
    const a = lineHash({ seq: 1, prev_hash: "a".repeat(64) });
    const b = lineHash({ seq: 1, prev_hash: "b".repeat(64) });
    expect(a).not.toBe(b);
  });
});

describe("appendChainedLine", () => {
  it("starts at genesis and chains each line to the previous one", async () => {
    const file = path.join(await tmp(), "evidence", "trace.jsonl");
    for (let i = 0; i < 3; i++) {
      await appendChainedLine(file, (n) => ({ ...n, i }));
    }
    const lines = await readLines(file);
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(lines[0]?.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(lines[1]?.prev_hash).toBe(lineHash(lines[0]));
    expect(lines[2]?.prev_hash).toBe(lineHash(lines[1]));
  });

  it("writes canonical bytes and leaves no lock behind", async () => {
    const dir = await tmp();
    const file = path.join(dir, "t.jsonl");
    const r = await appendChainedLine(file, (n) => ({ z: 1, ...n, a: 2 }));
    const text = await readFile(file, "utf8");
    expect(text).toBe(`${canonicalJson(JSON.parse(text))}\n`);
    expect(r.hash).toBe(lineHash(JSON.parse(text)));
    await expect(readFile(`${file}.lock`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to extend an unchained (greenfield) file and leaves it untouched", async () => {
    const file = path.join(await tmp(), "t.jsonl");
    const old = `${JSON.stringify({ grant_id: "g", halt_reason: "completed" })}\n`;
    await writeFile(file, old);
    await expect(
      appendChainedLine(file, (n) => ({ ...n })),
    ).rejects.toMatchObject({ code: "unchained" });
    expect(await readFile(file, "utf8")).toBe(old);
  });

  it("refuses a torn last line (no newline, or invalid JSON)", async () => {
    const dir = await tmp();
    const a = path.join(dir, "a.jsonl");
    await appendChainedLine(a, (n) => ({ ...n }));
    await writeFile(a, '{"seq":1,"prev', { flag: "a" });
    await expect(
      appendChainedLine(a, (n) => ({ ...n })),
    ).rejects.toBeInstanceOf(TraceChainError);
    const b = path.join(dir, "b.jsonl");
    await writeFile(b, "{not json}\n");
    await expect(appendChainedLine(b, (n) => ({ ...n }))).rejects.toMatchObject(
      {
        code: "torn-tail",
      },
    );
  });

  it("breaks a lock left by a dead process", async () => {
    const file = path.join(await tmp(), "t.jsonl");
    // pid 2^22+ is beyond any real pid on the platforms we run on.
    await writeFile(`${file}.lock`, `${4_194_999}:deadbeef`);
    const r = await appendChainedLine(file, (n) => ({ ...n }));
    expect(r.seq).toBe(0);
  });

  it("breaks a lock whose creator never wrote a pid", async () => {
    const file = path.join(await tmp(), "t.jsonl");
    await writeFile(`${file}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    await utimes(`${file}.lock`, old, old);
    const r = await appendChainedLine(file, (n) => ({ ...n }));
    expect(r.seq).toBe(0);
  });

  it("two processes appending concurrently keep the chain intact", async () => {
    const file = path.join(await tmp(), "t.jsonl");
    const child = path.join(here, "trace-chain.child.ts");
    const N = 40;
    const run = (who: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const p = spawn(
          process.execPath,
          ["--import", "tsx", child, file, who, String(N)],
          { cwd: pkgDir, stdio: ["ignore", "ignore", "inherit"] },
        );
        p.on("error", reject);
        p.on("exit", (code) => resolve(code ?? -1));
      });
    const codes = await Promise.all([run("a"), run("b")]);
    expect(codes).toEqual([0, 0]);
    const lines = await readLines(file);
    expect(lines).toHaveLength(2 * N);
    expect(lines.map((l) => l.seq)).toEqual(
      Array.from({ length: 2 * N }, (_, i) => i),
    );
    expect(lines[0]?.prev_hash).toBe(GENESIS_PREV_HASH);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.prev_hash).toBe(lineHash(lines[i - 1]));
    }
    for (const who of ["a", "b"]) {
      const mine = lines.filter((l) => l.who === who).map((l) => l.i);
      expect(mine).toEqual(Array.from({ length: N }, (_, i) => i));
    }
  }, 60_000);
});

describe("splitTrace", () => {
  it("flags a missing final newline and an invalid last line as torn", () => {
    expect(splitTrace('{"a":1}\n').torn).toBe(false);
    expect(splitTrace('{"a":1}\n{"b"').torn).toBe(true);
    expect(splitTrace('{"a":1}\n{bad}\n').torn).toBe(true);
    expect(splitTrace('{bad}\n{"a":1}\n').torn).toBe(false);
    expect(splitTrace("").lines).toEqual([]);
  });
});

describe("tip and bundle HMACs", () => {
  it("verify with the key and fail on any change", () => {
    const hmac = signTip(3, "c".repeat(64), KEY);
    expect(verifyTip({ seq: 3, hash: "c".repeat(64), hmac }, KEY)).toBe(true);
    expect(verifyTip({ seq: 4, hash: "c".repeat(64), hmac }, KEY)).toBe(false);
    expect(verifyTip({ seq: 3, hash: "d".repeat(64), hmac }, KEY)).toBe(false);
    expect(
      verifyTip({ seq: 3, hash: "c".repeat(64), hmac }, "cd".repeat(32)),
    ).toBe(false);
  });
  it("bundle index hmac is over the index without hmac", () => {
    const idx = { schemaVersion: "1.0.0", sliceId: "s", files: [] };
    const hmac = signBundleIndex(idx, KEY);
    expect(verifyBundleIndex({ ...idx, hmac }, KEY)).toBe(true);
    expect(verifyBundleIndex({ ...idx, sliceId: "t", hmac }, KEY)).toBe(false);
  });
});
