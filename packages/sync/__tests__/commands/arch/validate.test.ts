import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCommand } from "../../../src/commands/arch/validate.js";

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
