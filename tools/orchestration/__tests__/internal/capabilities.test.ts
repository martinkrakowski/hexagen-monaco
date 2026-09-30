import { afterEach, describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { hasCommand, probeHttp } from "../../src/internal/capabilities.js";

/**
 * F6: `doctor` reported `gh` and `yarn` missing on every Linux runner, because
 * `command` is a shell builtin and `execFile` runs no shell. macOS ships a
 * `/usr/bin/command` shim, which is the only reason it ever worked here.
 *
 * These tests run the REAL probe. The third one removes the shim from the
 * picture by giving the probe a PATH that holds exactly one executable, which
 * is what an Ubuntu host looks like to a probe that needs `command`.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("hasCommand, un-injected", () => {
  test("is true for node", async () => {
    expect(await hasCommand("node")).toBe(true);
  });

  test("is false for a name nothing is called", async () => {
    const name = `hexagen-no-such-cmd-${Math.random().toString(36).slice(2)}`;
    expect(await hasCommand(name)).toBe(false);
  });

  test("finds a command on a PATH that has no `command` shim (a Linux host)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestration-path-"));
    dirs.push(dir);
    const file = join(dir, "hexagen-fake-gh");
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
    const env = { PATH: dir };
    expect(await hasCommand("hexagen-fake-gh", env)).toBe(true);
    expect(await hasCommand("hexagen-fake-yarn", env)).toBe(false);
  });

  test("a name is never interpreted as shell", async () => {
    expect(await hasCommand("node; echo pwned")).toBe(false);
  });
});

describe("probeHttp (the doctor's opencode reachability probe)", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });

  const listen = async (
    handler: Parameters<typeof createServer>[1],
  ): Promise<string> => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  };

  test("a 302 is reported as a redirect, and its target is never requested", async () => {
    let targetHits = 0;
    const target = await listen((_req, res) => {
      targetHits += 1;
      res.end("secret");
    });
    const redirecting = await listen((_req, res) => {
      res.writeHead(302, { Location: target });
      res.end();
    });

    expect(await probeHttp(redirecting)).toEqual({ redirect: target });
    expect(targetHits).toBe(0);
  });

  test("any ordinary answer, even a 500, is reachable", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    expect(await probeHttp(url)).toBe(true);
  });

  test("nothing listening is unreachable", async () => {
    const url = await listen((_req, res) => res.end());
    const [server] = servers.splice(0);
    await new Promise((done) => server!.close(done));
    expect(await probeHttp(url)).toBe(false);
  });

  test("a server that never answers is cut off at the timeout", async () => {
    const url = await listen(() => undefined);
    const started = Date.now();
    expect(await probeHttp(url, 150)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
