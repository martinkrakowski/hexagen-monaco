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

function assertOk(value: boolean, message?: string) {
  if (!value) throw new Error(message || "Assertion failed");
}

async function runTests() {
  console.log("Running validateCommand tests...\n");

  let tempDir: string;
  let originalCwd: () => string;
  let originalExit: (code?: number) => void;
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let logs: string[] = [];
  let warnings: string[] = [];
  let errors: string[] = [];

  // Test 1: Validation passes (mock linter to succeed)
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const archDir1 = path.join(tempDir, ".architecture");
  await fs.mkdir(archDir1, { recursive: true });
  await fs.writeFile(
    path.join(archDir1, "manifest.yaml"),
    validManifestYaml,
    "utf8",
  );

  originalCwd = process.cwd;
  originalExit = process.exit;
  originalConsoleLog = console.log;
  originalConsoleWarn = console.warn;
  originalConsoleError = console.error;
  logs = [];
  warnings = [];
  errors = [];
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

  assertOk(
    output1.includes("✅ Architecture is compliant"),
    "Should show compliance message",
  );
  console.log("✅ validateCommand: passes when linter succeeds");

  console.log("\n✅ All validateCommand tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
