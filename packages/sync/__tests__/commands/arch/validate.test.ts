import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCommand } from "../../../src/commands/arch/validate.js";

/**
 * Install a fake `hexagen-lint` bin so validateManifest can actually invoke it.
 * `exitCode` 0 = compliant, non-zero = violations.
 */
async function installFakeLinter(dir: string, exitCode = 0): Promise<void> {
  const binDir = path.join(dir, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(
      path.join(binDir, "hexagen-lint.cmd"),
      `@echo off\r\nexit /b ${exitCode}\r\n`,
    );
  } else {
    const bin = path.join(binDir, "hexagen-lint");
    await fs.writeFile(bin, `#!/bin/sh\nexit ${exitCode}\n`);
    await fs.chmod(bin, 0o755);
  }
}

const validManifestYaml = `
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    layers:
      domain:
        entities:
          - Entity1
`;

describe("validateCommand", () => {
  it("should pass when linter succeeds", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
    const archDir1 = path.join(tempDir, ".architecture");
    await fs.mkdir(archDir1, { recursive: true });
    await fs.writeFile(
      path.join(archDir1, "manifest.yaml"),
      validManifestYaml,
      "utf8",
    );
    await installFakeLinter(tempDir, 0);

    const originalCwd = process.cwd;
    const originalExit = process.exit;
    const originalConsoleLog = console.log;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;
    const logs: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      errors.push(args.map(String).join(" "));
    (process.exit as () => void) = () => {};
    (process.cwd as () => string) = () => tempDir;

    await validateCommand();
    const output1 = logs.join("\n");

    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    await fs.rm(tempDir, { recursive: true, force: true });

    assert.ok(output1.includes("Architecture is compliant"));
  });
});
