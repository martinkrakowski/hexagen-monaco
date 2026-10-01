import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SESSION, idle, sseHead, startFake, type Fake } from "./fixtures.js";

/** The BUILT bin, as a consumer runs it, against a local fake server. */
const BIN = resolve(import.meta.dirname, "../../dist/bins/lane-watch.js");

const fakes: Fake[] = [];
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close();
});
beforeAll(() => {
  expect(existsSync(BIN), "run `yarn build` first").toBe(true);
});

function runBin(
  args: string[],
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: {} });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => done({ code, out, err }));
  });
}

describe("the built lane-watch bin", () => {
  test("a non-loopback --server exits 2 with the usage, and prints nothing on stdout", () => {
    const result = spawnSync(
      process.execPath,
      [BIN, "usage", "--server", "http://example.com", "--session", SESSION],
      {
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("LOOPBACK");
    expect(result.stderr).toContain("exit codes");
  });

  test("follow ends 0 on session.idle", async () => {
    const fake = await startFake((_req, res) => {
      sseHead(res);
      res.write(idle());
    });
    fakes.push(fake);
    const result = await runBin([
      "follow",
      "--server",
      fake.origin,
      "--session",
      SESSION,
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("done");
  });

  test("usage on an incomplete reading exits 3", async () => {
    const fake = await startFake((_req, res) => {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: SESSION }));
    });
    fakes.push(fake);
    const result = await runBin([
      "usage",
      "--server",
      fake.origin,
      "--session",
      SESSION,
    ]);
    expect(result.code).toBe(3);
    expect(result.out).toContain("unknown");
  });

  test("SIGTERM interrupts a follow that is waiting: exit 143", async () => {
    const fake = await startFake((_req, res) => sseHead(res));
    fakes.push(fake);
    const child = spawn(process.execPath, [
      BIN,
      "follow",
      "--server",
      fake.origin,
      "--session",
      SESSION,
      "--stall-seconds",
      "60",
    ]);
    const exited = new Promise<number | null>((done) =>
      child.on("close", (code) => done(code)),
    );
    await new Promise((ok) => setTimeout(ok, 500));
    child.kill("SIGTERM");
    expect(await exited).toBe(143);
  });
});
