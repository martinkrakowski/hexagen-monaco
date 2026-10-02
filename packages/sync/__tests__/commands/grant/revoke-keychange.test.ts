import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let calls = 0;
vi.mock("@hexagen/shared/node/grant-key", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hexagen/shared/node/grant-key")>();
  return {
    ...actual,
    readGrantKey: (p: string) => {
      const r = actual.readGrantKey(p);
      calls += 1;
      // The first read verifies; a later one sees a different key.
      return calls > 1 && r.ok ? { ...r, fingerprint: "changed" } : r;
    },
  };
});

import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";
import { signGrantPayload } from "../../../src/commands/grant/sign.js";
import { grantRevokeCommand } from "../../../src/commands/grant/revoke.js";

let dir: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("grant revoke key stability", () => {
  it("fails with exit 1 and writes nothing when the key changes mid-run", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rv-kc-"));
    execFileSync("git", ["init", "-q", dir]);
    await mkdir(path.join(dir, ".hexagen", "grants"), { recursive: true });
    const keyHex = "ab".repeat(32);
    const keyFile = path.join(dir, "k.key");
    await writeFile(keyFile, `${keyHex}\n`);
    const g = {
      id: "g-1",
      principal: "m",
      agent: "a",
      paths: ["src/"],
      tools: ["t"],
      mode: "propose" as const,
      expires_at: "2026-10-01T18:00:00Z",
    };
    const grantFile = path.join(dir, ".hexagen", "grants", "g.json");
    await writeFile(
      grantFile,
      JSON.stringify({
        ...g,
        signature: signGrantPayload(canonicalGrantPayload(g), keyHex),
      }),
    );
    const before = await readFile(grantFile, "utf-8");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    calls = 0;
    await grantRevokeCommand({
      grantFile,
      workspaceRoot: dir,
      keyFile,
      env: {},
      yes: true,
      now: new Date("2026-10-01T12:00:00Z"),
    });
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toContain(
      "key changed during revoke; nothing written",
    );
    expect(await readFile(grantFile, "utf-8")).toBe(before);
  });
});
