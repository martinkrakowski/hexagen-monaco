import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  symlink,
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
    const first = await run();
    expect(first.exitCode).toBe(0);
    expect(first.messages.join("\n")).toMatch(
      /new tip \(record it out of band\): seq 0 hash [0-9a-f]{64} hmac [0-9a-f]{64}/,
    );
    const verdict = async (): Promise<Record<string, unknown>> =>
      JSON.parse(
        (await unzip(bundlePath())).get("evidence/verdicts.json") as string,
      );
    const v1 = await verdict();
    expect(v1.tipAnchoredBefore).toBe(false);
    expect(v1.previousTip).toBeNull();
    const firstTip = JSON.parse(await readFile(tipPath(), "utf8"));
    await rm(bundlePath());
    await append(evLine());
    await append(evLine());
    expect((await run()).exitCode).toBe(0);
    expect(JSON.parse(await readFile(tipPath(), "utf8")).seq).toBe(2);
    const v2 = await verdict();
    expect(v2.tipAnchoredBefore).toBe(true);
    expect(v2.previousTip).toEqual({ seq: 0, hash: firstTip.hash });
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
    await failsClean(
      r,
      /seq 2: seq 2 does not match position 1; prev_hash does not match the previous line/,
    );
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

describe("evidence pack, window and shape", () => {
  const callAt = (time: string, name = "hexagen_propose_patch") => ({
    tool_calls: [
      { name, args_digest: "sha256:aa", result_digest: "sha256:bb", time },
    ],
  });

  it("a call exactly at expires_at is valid, one millisecond later is not", async () => {
    await append(evLine(callAt("2026-12-01T00:00:00.000Z")));
    expect((await run()).exitCode).toBe(0);
    await rm(bundlePath());
    await rm(tipPath());
    await rm(traceFile);
    await append(evLine(callAt("2026-12-01T00:00:00.001Z")));
    await failsClean(await run(), /after grant 'grant-1' expires_at/);
  });

  it("hexagen_accept_transaction is allowed without being in grant.tools", async () => {
    await append(
      evLine(callAt("2026-10-01T10:00:00.000Z", "hexagen_accept_transaction")),
    );
    expect((await run()).exitCode).toBe(0);
  });

  it("names every missing field of a grant_missing record", async () => {
    await append({ kind: "grant_missing" });
    const r = await run();
    await failsClean(
      r,
      /tool is missing; reason is missing; time is not an ISO timestamp/,
    );
  });

  it("rejects a malformed evidence line field by field", async () => {
    await append({
      grant_id: "grant-1",
      halt_reason: "completed",
      started_at: "yesterday",
      ended_at: "2026-10-01T10:00:00.000Z",
      transaction_ids: "tx",
      tool_calls: [{ name: "hexagen_propose_patch" }],
    });
    const r = await run();
    await failsClean(
      r,
      /goal_id is missing; started_at is not an ISO timestamp; transaction_ids is not an array; tool_calls\[0\] is malformed/,
    );
  });

  it("rejects an unknown record kind", async () => {
    await append({ kind: "mystery" });
    await failsClean(await run(), /unknown record kind 'mystery'/);
  });
});

describe("evidence pack, grant and shape validation", () => {
  const resign = (g: Record<string, unknown>): Record<string, unknown> => {
    const rest = { ...g };
    delete rest.signature;
    return {
      ...rest,
      signature: signGrantPayload(canonicalGrantPayload(rest as never), KEY),
    };
  };

  it("a validly signed grant that is not a strict Field Kit grant is not verified", async () => {
    await append(evLine());
    const base = signedGrant();
    const noPrincipal = { ...base };
    delete noPrincipal.principal;
    const cases: [string, Record<string, unknown>][] = [
      ["an unknown field", { ...base, extra: 1 }],
      [
        "a date with no offset",
        resign({ ...base, expires_at: "2026-12-01T00:00:00" }),
      ],
      ["a missing principal", resign(noPrincipal)],
      ["an empty tool name", resign({ ...base, tools: [""] })],
    ];
    for (const [label, grant] of cases) {
      await writeFile(grantFile, JSON.stringify(grant));
      const r = await run();
      expect(r.exitCode, label).toBe(1);
      expect(r.messages.join("\n"), label).toMatch(/is not a grant/);
      expect(await exists(bundlePath()), label).toBe(false);
    }
  });

  it("every transaction_ids entry must be a non-empty string", async () => {
    await append(evLine({ transaction_ids: ["tx", ""] }));
    await failsClean(
      await run(),
      /transaction_ids\[1\] is not a non-empty string/,
    );
    await rm(traceFile);
    await append(evLine({ transaction_ids: [7] }));
    await failsClean(
      await run(),
      /transaction_ids\[0\] is not a non-empty string/,
    );
  });
});

describe("evidence pack, a raced output directory", () => {
  beforeEach(async () => {
    await append(evLine());
  });

  const swap = (outside: string) => async (): Promise<void> => {
    await rename(
      path.join(root, ".hexagen", "sub"),
      path.join(root, ".hexagen", "sub-moved"),
    );
    await symlink(outside, path.join(root, ".hexagen", "sub"));
  };

  it("refuses an ancestor swapped for a symlink after the preflight", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "evidence-outside-"));
    dirs.push(outside);
    const r = await run({
      out: ".hexagen/sub/bundle.zip",
      beforeWrite: swap(outside),
    });
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/moved while|resolves outside/);
    expect(await readdir(outside)).toEqual([]);
    expect(await exists(tipPath())).toBe(false);
  });

  it("refuses a directory swapped after the temp file was written", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "evidence-outside-"));
    dirs.push(outside);
    const r = await run({
      out: ".hexagen/sub/bundle.zip",
      beforeLink: swap(outside),
    });
    expect(r.exitCode).toBe(2);
    expect(await readdir(outside)).toEqual([]);
    expect(await exists(tipPath())).toBe(false);
  });
});

describe("evidence pack, locking", () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i++) await append(evLine());
  });

  it("a lock that cannot be taken is a precondition failure (2), not invalid evidence", async () => {
    await writeFile(
      `${traceFile}.lock`,
      `${process.pid}:${Date.now()}:cafebabe`,
    );
    const r = await run({ lockTimeoutMs: 150 });
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(
      /could not take .*\.lock within 150 ms/,
    );
    expect(await exists(bundlePath())).toBe(false);
    expect(await exists(tipPath())).toBe(false);
  });

  it("a trace that becomes unreadable after the path check is exit 2", async () => {
    // A directory in place of the file passes the path check, then the read
    // inside the lock fails (EISDIR).
    await rm(traceFile);
    await mkdir(traceFile);
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/cannot read the trace/);
    expect(await exists(bundlePath())).toBe(false);
  });

  it("two packs racing never move the tip backwards", async () => {
    const bOut = ".hexagen/b.zip";
    let b: Promise<Awaited<ReturnType<typeof run>>> | undefined;
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const a = await run({
      out: ".hexagen/a.zip",
      beforeTipWrite: async () => {
        // Another writer appends and a second pack runs while this one is
        // between validating and writing its tip.
        b = (async () => {
          await append(evLine());
          await append(evLine());
          return run({ out: bOut });
        })();
        await Promise.race([b, sleep(400)]);
      },
    });
    expect(a.exitCode).toBe(0);
    const bResult = await b;
    expect(bResult?.exitCode).toBe(0);
    const tip = JSON.parse(await readFile(tipPath(), "utf8"));
    expect(tip.seq).toBe(4);
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

  it("refuses an empty trace as a precondition failure", async () => {
    await writeFile(traceFile, "");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/no lines/);
    expect(await exists(bundlePath())).toBe(false);
  });

  it("refuses --out under .hexagen/evidence/ and leaves the evidence alone", async () => {
    const before = await readFile(traceFile, "utf8");
    for (const out of [
      ".hexagen/evidence/trace.jsonl",
      ".hexagen/evidence/bundle.zip",
      ".hexagen/evidence/tip.json",
    ]) {
      const r = await run({ out });
      expect(r.exitCode).toBe(2);
      expect(r.messages.join("\n")).toMatch(/must not be under/);
    }
    expect(await readFile(traceFile, "utf8")).toBe(before);
    expect(
      await exists(path.join(root, ".hexagen", "evidence", "bundle.zip")),
    ).toBe(false);
  });

  it("refuses --out names that BUNDLE_FORBIDDEN_PATH_PATTERN forbids", async () => {
    for (const out of [
      ".hexagen/engagement.key",
      ".hexagen/keys/b.zip",
      ".hexagen/.env.zip",
    ]) {
      const r = await run({ out });
      expect(r.exitCode).toBe(2);
      expect(r.messages.join("\n")).toMatch(/key or env file/);
      expect(await exists(path.join(root, out))).toBe(false);
    }
  });

  it("refuses an existing --out and never alters or deletes it", async () => {
    await writeFile(bundlePath(), "precious");
    const r = await run();
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/already exists/);
    expect(await readFile(bundlePath(), "utf8")).toBe("precious");
    expect(await exists(tipPath())).toBe(false);
  });

  it("an --out that appears during the pack is never replaced or rolled back", async () => {
    const r = await run({
      beforeWrite: async () => {
        await writeFile(bundlePath(), "raced");
      },
    });
    expect(r.exitCode).toBe(2);
    expect(await readFile(bundlePath(), "utf8")).toBe("raced");
    expect(await exists(tipPath())).toBe(false);
  });

  it("a failed tip write rolls back its own bundle and writes no tip", async () => {
    const r = await run({
      writeTip: async () => {
        throw new Error("disk full");
      },
    });
    expect(r.exitCode).toBe(2);
    expect(r.messages.join("\n")).toMatch(/disk full/);
    expect(await exists(bundlePath())).toBe(false);
    expect(await exists(tipPath())).toBe(false);
    // Nothing is left behind, so the same pack can be retried.
    expect((await run()).exitCode).toBe(0);
  });

  it("reads the trace under the writer's lock", async () => {
    const lock = `${traceFile}.lock`;
    await writeFile(lock, `${process.pid}:${Date.now()}:cafebabe`);
    let done = false;
    const pending = run().then((r) => {
      done = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(done).toBe(false);
    await rm(lock);
    expect((await pending).exitCode).toBe(0);
    expect(await exists(lock)).toBe(false);
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
