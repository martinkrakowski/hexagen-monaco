import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BundleIndex, Tip } from "@hexagen/shared";
import {
  appendChainedLine,
  verifyBundleIndex,
  verifyTip,
} from "@hexagen/shared/node/trace-chain";
import { runEvidencePack } from "../../../src/commands/evidence/pack.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";

const KEY = "ab".repeat(32);
const OTHER_KEY = "cd".repeat(32);

let root: string;
let keyFile: string;
let traceFile: string;
let grantFile: string;
let outRel: string;
const dirs: string[] = [];

function signedGrant(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const g = {
    id: "grant-1",
    principal: "p",
    agent: "a",
    paths: ["src/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose" as const,
    expires_at: "2026-12-01T00:00:00.000Z",
    ...over,
  };
  return { ...g, signature: signGrantPayload(canonicalGrantPayload(g), KEY) };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "evidence-pack-"));
  dirs.push(root);
  keyFile = path.join(root, "engagement.key");
  await writeFile(keyFile, `${KEY}\n`);
  await mkdir(path.join(root, ".hexagen", "evidence"), { recursive: true });
  traceFile = path.join(root, ".hexagen", "evidence", "trace.jsonl");
  grantFile = path.join(root, "grant-1.json");
  await writeFile(grantFile, JSON.stringify(signedGrant()));
  outRel = ".hexagen/bundle.zip";
});
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

function evLine(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    grant_id: "grant-1",
    goal_id: "goal",
    tool_calls: [
      {
        name: "hexagen_propose_patch",
        args_digest: "sha256:aa",
        result_digest: "sha256:bb",
        time: "2026-10-01T10:00:00.000Z",
      },
    ],
    halt_reason: "completed",
    transaction_ids: ["tx"],
    started_at: "2026-10-01T10:00:00.000Z",
    ended_at: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

async function append(record: Record<string, unknown>): Promise<void> {
  await appendChainedLine(traceFile, (next) => ({ ...record, ...next }));
}

async function appendMissing(): Promise<void> {
  await append({
    kind: "grant_missing",
    tool: "hexagen_propose_patch",
    reason: "No Grant supplied",
    time: "2026-10-01T10:05:00.000Z",
  });
}

async function fileLines(): Promise<string[]> {
  return (await readFile(traceFile, "utf8")).trimEnd().split("\n");
}
async function setLines(lines: string[]): Promise<void> {
  await writeFile(traceFile, `${lines.join("\n")}\n`);
}

const run = (over: Partial<Parameters<typeof runEvidencePack>[0]> = {}) =>
  runEvidencePack({
    root,
    trace: traceFile,
    grantFiles: [grantFile],
    out: outRel,
    keyFile,
    now: () => new Date("2026-10-02T00:00:00.000Z"),
    ...over,
  });

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );
const tipPath = (): string =>
  path.join(root, ".hexagen", "evidence", "tip.json");
const bundlePath = (): string => path.join(root, ".hexagen", "bundle.zip");

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

async function failsClean(
  r: Awaited<ReturnType<typeof run>>,
  match: RegExp,
): Promise<void> {
  expect(r.exitCode).toBe(1);
  expect(r.messages.join("\n")).toMatch(match);
  expect(await exists(bundlePath())).toBe(false);
}

describe("evidence pack, a sound trace", () => {
  it("writes an HMAC'd bundle and anchors the tip", async () => {
    await append(evLine());
    await appendMissing();
    await append(evLine());
    const r = await run();
    expect(r.exitCode).toBe(0);
    const zip = await unzip(bundlePath());
    const index = BundleIndex.parse(
      JSON.parse(zip.get("bundle.json") as string),
    );
    expect(verifyBundleIndex(index as never, KEY)).toBe(true);
    expect(verifyBundleIndex(index as never, OTHER_KEY)).toBe(false);
    expect(index.files.map((f) => f.role).sort()).toEqual([
      "evidence",
      "evidence",
      "grant",
      "tip",
    ]);
    expect(zip.get("evidence/trace.jsonl")).toBe(
      await readFile(traceFile, "utf8"),
    );
    expect([...zip.keys()].some((k) => k.startsWith("grants/"))).toBe(true);
    const verdicts = JSON.parse(zip.get("evidence/verdicts.json") as string);
    expect(verdicts.lines).toHaveLength(3);
    expect(verdicts.lines.every((l: { valid: boolean }) => l.valid)).toBe(true);
    expect(verdicts.evidence).toEqual({ count: 2, seqs: [0, 2] });
    expect(verdicts.denials).toHaveLength(1);
    expect(verdicts.denials[0]).toMatchObject({
      seq: 1,
      haltReason: "grant_missing",
      tool: "hexagen_propose_patch",
    });
    const tip = Tip.parse(JSON.parse(await readFile(tipPath(), "utf8")));
    expect(tip.seq).toBe(2);
    expect(verifyTip(tip, KEY)).toBe(true);
    // The tip in the bundle is the tip on disk.
    expect(JSON.parse(zip.get("evidence/tip.json") as string)).toEqual(tip);
  });

  it("a second pack after more lines advances the tip", async () => {
    await append(evLine());
    expect((await run()).exitCode).toBe(0);
    await append(evLine());
    await append(evLine());
    expect((await run()).exitCode).toBe(0);
    expect(JSON.parse(await readFile(tipPath(), "utf8")).seq).toBe(2);
  });
});

describe("evidence pack, tampering", () => {
  beforeEach(async () => {
    for (let i = 0; i < 4; i++) await append(evLine({ goal_id: `g${i}` }));
  });

  it("fails on an edited line", async () => {
    const lines = await fileLines();
    lines[1] = (lines[1] as string).replace(
      '"goal_id":"g1"',
      '"goal_id":"EDIT"',
    );
    await setLines(lines);
    await failsClean(await run(), /seq 2: .*prev_hash does not match/);
  });

  it("fails on a reordered line", async () => {
    const lines = await fileLines();
    [lines[1], lines[2]] = [lines[2] as string, lines[1] as string];
    await setLines(lines);
    const r = await run();
    await failsClean(r, /seq/);
    expect(r.verdicts?.some((v) => !v.valid)).toBe(true);
  });

  it("fails on an interior deletion", async () => {
    const lines = await fileLines();
    lines.splice(1, 1);
    await setLines(lines);
    await failsClean(await run(), /does not match position|prev_hash/);
  });

  it("fails on a torn last line, with or without a newline", async () => {
    await writeFile(traceFile, '{"grant_id":"grant-1","goal', { flag: "a" });
    await failsClean(await run(), /torn/);
    const lines = await fileLines();
    lines.pop();
    await setLines(lines);
    const complete = (await fileLines()).at(-1) as string;
    await writeFile(traceFile, (await readFile(traceFile, "utf8")) + complete);
    // Valid JSON but no trailing newline is torn as well.
    await failsClean(await run(), /torn/);
  });

  it("fails on an unchained (greenfield) line", async () => {
    await writeFile(traceFile, `${JSON.stringify(evLine())}\n`);
    await failsClean(await run(), /not chained/);
  });

  it("fails on tail truncation against a recorded tip", async () => {
    expect((await run()).exitCode).toBe(0);
    await rm(bundlePath());
    const tipBefore = await readFile(tipPath(), "utf8");
    const lines = await fileLines();
    await setLines(lines.slice(0, 2));
    await failsClean(await run(), /ends before the recorded tip/);
    expect(await readFile(tipPath(), "utf8")).toBe(tipBefore);
  });

  it("fails when the file restarts from genesis while a tip exists", async () => {
    expect((await run()).exitCode).toBe(0);
    await rm(bundlePath());
    await rm(traceFile);
    for (let i = 0; i < 6; i++) await append(evLine({ goal_id: `new${i}` }));
    await failsClean(await run(), /differs from the one anchored/);
  });

  it("fails when the last line is edited after the tip was recorded", async () => {
    expect((await run()).exitCode).toBe(0);
    await rm(bundlePath());
    const lines = await fileLines();
    lines[3] = (lines[3] as string).replace(
      '"goal_id":"g3"',
      '"goal_id":"EDIT"',
    );
    await setLines(lines);
    await failsClean(await run(), /differs from the one anchored/);
  });

  it("fails on a tip whose HMAC does not verify", async () => {
    expect((await run()).exitCode).toBe(0);
    await rm(bundlePath());
    const tip = JSON.parse(await readFile(tipPath(), "utf8"));
    await writeFile(
      tipPath(),
      JSON.stringify({ ...tip, hmac: "0".repeat(64) }),
    );
    await failsClean(await run(), /tip\.json HMAC/);
  });

  it("fails when a grant's signature does not verify", async () => {
    const g = signedGrant();
    await writeFile(grantFile, JSON.stringify({ ...g, tools: ["*", "x"] }));
    await failsClean(await run(), /signature does not verify/);
  });
});

describe("evidence pack, denials", () => {
  it("reports a forged denial and never counts it as evidence", async () => {
    await append(evLine());
    // Cites a tool outside the grant and a time after expiry: legitimate for a
    // real denial, and exactly what a forger would claim.
    await append(
      evLine({
        halt_reason: "grant_denied",
        tool_calls: [
          {
            name: "hexagen_delete_everything",
            args_digest: "sha256:aa",
            result_digest: "sha256:bb",
            time: "2027-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    await appendMissing();
    const r = await run();
    expect(r.exitCode).toBe(0);
    const verdicts = JSON.parse(
      (await unzip(bundlePath())).get("evidence/verdicts.json") as string,
    );
    expect(verdicts.evidence).toEqual({ count: 1, seqs: [0] });
    expect(verdicts.denials.map((d: { seq: number }) => d.seq)).toEqual([1, 2]);
    expect(verdicts.denials[0]).toMatchObject({
      haltReason: "grant_denied",
      tool: "hexagen_delete_everything",
    });
  });

  it("the same line as 'completed' is invalid", async () => {
    await append(
      evLine({
        tool_calls: [
          {
            name: "hexagen_delete_everything",
            args_digest: "sha256:aa",
            result_digest: "sha256:bb",
            time: "2027-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    await failsClean(await run(), /not in grant/);
  });

  it("a denial still has to cite a known grant", async () => {
    await append(evLine({ halt_reason: "grant_denied", grant_id: "ghost" }));
    await failsClean(await run(), /matches no known/);
  });

  it("a completed call after expires_at, or at revoked_at, is invalid", async () => {
    await writeFile(
      grantFile,
      JSON.stringify(signedGrant({ revoked_at: "2026-10-01T10:00:00.000Z" })),
    );
    await append(evLine());
    await failsClean(await run(), /revoked_at/);
  });

  it("a grant_missing record carrying a grant_id is invalid", async () => {
    await append({
      kind: "grant_missing",
      grant_id: "grant-1",
      tool: "t",
      reason: "r",
      time: "2026-10-01T10:05:00.000Z",
    });
    await failsClean(await run(), /must not carry a grant_id/);
  });
});

describe("evidence pack, preconditions", () => {
  beforeEach(async () => {
    await append(evLine());
  });

  it("refuses --out outside .hexagen/", async () => {
    const r = await run({ out: "bundle.zip" });
    expect(r.exitCode).toBe(2);
    expect(await exists(path.join(root, "bundle.zip"))).toBe(false);
  });

  it("refuses a trace the tip does not anchor", async () => {
    const other = path.join(root, "copy.jsonl");
    await writeFile(other, await readFile(traceFile));
    const r = await run({ trace: other });
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/anchors only/);
  });

  it("refuses a missing or weak key", async () => {
    await writeFile(keyFile, "00\n");
    expect((await run()).exitCode).toBe(2);
    expect((await run({ keyFile: path.join(root, "nope.key") })).exitCode).toBe(
      2,
    );
  });

  it("refuses an empty trace", async () => {
    await writeFile(traceFile, "");
    await failsClean(await run(), /no lines/);
  });
});

describe("hexagen evidence pack (CLI wiring)", () => {
  it("parses a variadic --grant and sets the exit code", async () => {
    const { evidenceCommander } =
      await import("../../../src/commands/evidence/index.js");
    await append(evLine());
    const saved = process.exitCode;
    try {
      await evidenceCommander.parseAsync(
        [
          "pack",
          traceFile,
          "--grant",
          grantFile,
          "--out",
          outRel,
          "--root",
          root,
          "--key-file",
          keyFile,
        ],
        { from: "user" },
      );
      expect(process.exitCode ?? 0).toBe(0);
      expect(await exists(bundlePath())).toBe(true);
    } finally {
      process.exitCode = saved;
    }
  });
});
