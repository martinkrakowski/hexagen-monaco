import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GENESIS_PREV_HASH, lineHash } from "@hexagen/shared/node/trace-chain";
import { TraceWriteAdapter } from "../../../src/infrastructure/adapters/trace-write.adapter.js";
import type { TraceAppendInput } from "../../../src/application/ports/out/trace-write.port.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "trace-adapter-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function makeRepoMode(root: string): Promise<void> {
  await mkdir(path.join(root, ".architecture"), { recursive: true });
  await writeFile(path.join(root, ".architecture", "manifest.yaml"), "x: 1\n");
}

const tracePath = (root: string): string =>
  path.join(root, ".hexagen", "evidence", "trace.jsonl");

function input(over: Partial<TraceAppendInput> = {}): TraceAppendInput {
  return {
    grant_id: "g1",
    goal_id: "goal",
    tool_call: {
      name: "hexagen_propose_patch",
      args: { a: 1 },
      result: { ok: true },
      time: "2026-10-01T10:00:00.000Z",
    },
    halt_reason: "completed",
    transaction_ids: ["tx1"],
    started_at: "2026-10-01T10:00:00.000Z",
    ended_at: "2026-10-01T10:00:00.000Z",
    ...over,
  };
}

async function lines(root: string): Promise<Record<string, unknown>[]> {
  return (await readFile(tracePath(root), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("TraceWriteAdapter, no manifest (brownfield)", () => {
  it("writes a chained trace from genesis, evidence and grant_missing alike", async () => {
    const root = await tmp();
    const adapter = new TraceWriteAdapter(root);
    expect((await adapter.appendLine(input())).success).toBe(true);
    expect(
      (
        await adapter.appendGrantMissing({
          tool: "hexagen_propose_patch",
          args: { p: 1 },
          reason: "No Grant supplied",
          time: "2026-10-01T10:01:00.000Z",
        })
      ).success,
    ).toBe(true);
    expect((await adapter.appendLine(input())).success).toBe(true);
    const l = await lines(root);
    expect(l.map((x) => x.seq)).toEqual([0, 1, 2]);
    expect(l[0]?.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(l[1]?.prev_hash).toBe(lineHash(l[0]));
    expect(l[2]?.prev_hash).toBe(lineHash(l[1]));
    expect(l[1]).toMatchObject({
      kind: "grant_missing",
      tool: "hexagen_propose_patch",
      reason: "No Grant supplied",
      time: "2026-10-01T10:01:00.000Z",
    });
    expect(String(l[1]?.args_digest)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(l[1]).not.toHaveProperty("grant_id");
    expect(l[0]).toHaveProperty("grant_id", "g1");
  });

  it("keeps extending an existing unchained trace plainly; grant_missing is a no-op", async () => {
    const root = await tmp();
    await mkdir(path.dirname(tracePath(root)), { recursive: true });
    const old = `${JSON.stringify({ grant_id: "old", halt_reason: "completed" })}\n`;
    await writeFile(tracePath(root), old);
    const adapter = new TraceWriteAdapter(root);
    expect((await adapter.appendLine(input())).success).toBe(true);
    expect(
      (
        await adapter.appendGrantMissing({
          tool: "t",
          reason: "r",
          time: "2026-10-01T10:00:00.000Z",
        })
      ).success,
    ).toBe(true);
    const text = await readFile(tracePath(root), "utf8");
    expect(text.startsWith(old)).toBe(true);
    const rows = text.trim().split("\n");
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1] as string)).not.toHaveProperty("seq");
  });

  it("refuses to append after a torn last line", async () => {
    const root = await tmp();
    const adapter = new TraceWriteAdapter(root);
    await adapter.appendLine(input());
    await writeFile(tracePath(root), '{"seq":1,"pre', { flag: "a" });
    const before = await readFile(tracePath(root), "utf8");
    expect((await adapter.appendLine(input())).success).toBe(false);
    expect(await readFile(tracePath(root), "utf8")).toBe(before);
  });
});

describe("TraceWriteAdapter, manifest present (greenfield)", () => {
  it("continues an existing chained trace, grant_missing included", async () => {
    const root = await tmp();
    const adapter = new TraceWriteAdapter(root);
    await adapter.appendLine(input());
    await makeRepoMode(root);
    await adapter.appendLine(input());
    await adapter.appendGrantMissing({
      tool: "t",
      reason: "r",
      time: "2026-10-01T10:00:00.000Z",
    });
    const l = await lines(root);
    expect(l.map((x) => x.seq)).toEqual([0, 1, 2]);
    expect(l[1]?.prev_hash).toBe(lineHash(l[0]));
    expect(l[2]).toHaveProperty("kind", "grant_missing");
  });

  it("keeps today's unchained line and writes nothing for grant_missing", async () => {
    const root = await tmp();
    await makeRepoMode(root);
    const adapter = new TraceWriteAdapter(root);
    expect(
      (
        await adapter.appendGrantMissing({
          tool: "t",
          reason: "r",
          time: "2026-10-01T10:00:00.000Z",
        })
      ).success,
    ).toBe(true);
    await expect(readFile(tracePath(root))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await adapter.appendLine(input());
    await adapter.appendLine(input());
    const text = await readFile(tracePath(root), "utf8");
    const rows = text.trim().split("\n");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const parsed = JSON.parse(row) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("seq");
      expect(parsed).not.toHaveProperty("prev_hash");
      // Today's serialisation: insertion order, not sorted.
      expect(Object.keys(parsed)[0]).toBe("grant_id");
    }
    await expect(readFile(`${tracePath(root)}.lock`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
