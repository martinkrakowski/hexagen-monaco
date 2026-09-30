import { afterEach, describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasCommand } from "../../src/internal/capabilities.js";

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
