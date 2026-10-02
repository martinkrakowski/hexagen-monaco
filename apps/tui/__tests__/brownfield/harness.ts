import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import React from "react";
import { render } from "ink";

class FakeStdout extends Writable {
  frames: string[] = [];
  columns = 120;
  _write(chunk: Buffer | string, _enc: string, cb: () => void): void {
    this.frames.push(chunk.toString());
    cb();
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  queue: string[] = [];
  read(): string | null {
    return this.queue.shift() ?? null;
  }
}

export function mount(tree: React.ReactElement) {
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  const app = render(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    frame: () => stdout.frames.at(-1) ?? "",
    press: (input: string) => {
      stdin.queue.push(input);
      stdin.emit("readable");
    },
    unmount: () => app.unmount(),
  };
}

export const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

export async function until(
  frame: () => string,
  needle: string,
  tries = 60,
): Promise<string> {
  for (let i = 0; i < tries; i += 1) {
    if (frame().includes(needle)) return frame();
    await tick(20);
  }
  return frame();
}

export function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "tui-bf-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

export const SLICE = JSON.stringify({
  schemaVersion: "1.0.0",
  id: "slice-1",
  repo: { commit: "abc1234" },
  paths: ["src/billing/"],
  excludes: ["src/billing/vendor/"],
  createdBy: "tester",
  createdAt: "2026-10-01T00:00:00Z",
});

const sec = (items: unknown[]) => ({ collected: true, items });
export const OBSERVED = JSON.stringify({
  schemaVersion: "1.0.0",
  repo: { commit: "abc1234" },
  generatedAt: "2026-10-01T00:00:00Z",
  packages: sec([]),
  languages: sec([]),
  build: sec([]),
  generated: sec([]),
  dontTouch: sec([]),
  edges: { collected: true, unreadLanguages: [], items: [] },
  unresolved: sec([]),
  limits: { truncated: false, reasons: [] },
});

export const GRANT = JSON.stringify({
  id: "g-1",
  principal: "p",
  agent: "a",
  paths: ["src/billing/"],
  tools: ["t"],
  mode: "propose",
  expires_at: "2030-01-01T00:00:00Z",
});

const H = "0".repeat(64);
export const TRACE = [
  {
    seq: 0,
    prev_hash: H,
    grant_id: "g-1",
    goal_id: "x",
    tool_calls: [
      {
        name: "tool_alpha",
        args_digest: "d",
        result_digest: "d",
        time: "2026-10-01T10:00:00Z",
      },
    ],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: "2026-10-01T10:00:00Z",
    ended_at: "2026-10-01T10:00:01Z",
  },
  {
    kind: "grant_missing",
    seq: 1,
    prev_hash: H,
    time: "2026-10-01T11:00:00Z",
    tool: "tool_beta",
    reason: "no grant",
  },
  {
    seq: 2,
    prev_hash: H,
    grant_id: "g-1",
    goal_id: "x",
    tool_calls: [
      {
        name: "tool_gamma",
        args_digest: "d",
        result_digest: "d",
        time: "2026-10-01T12:00:00Z",
      },
    ],
    halt_reason: "grant_denied",
    transaction_ids: [],
    started_at: "2026-10-01T12:00:00Z",
    ended_at: "2026-10-01T12:00:01Z",
  },
]
  .map((l) => JSON.stringify(l))
  .join("\n");
