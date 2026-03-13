import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listCommand } from "../../../src/commands/arch/list.js";

const validManifestYaml = `
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain:
        entities:
          - Entity1
  - name: project-configuration
    type: core
    description: Governance core
    depends_on:
      - shared
apps:
  - name: web
    driver: next.js
`;

const emptyManifestYaml = `
system: test
bounded_contexts: []
apps: []
`;

function assertOk(value: boolean, message?: string) {
  if (!value) throw new Error(message || "Assertion failed");
}

const testResults: string[] = [];

async function runTests() {
  console.log("Running listCommand tests...\n");

  let tempDir: string;
  let originalCwd: () => string;
  let originalExit: (code?: number) => void;
  let originalConsoleLog: typeof console.log;
  let logs: string[] = [];

  // Test 1: Valid manifest with contexts and apps
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
  logs = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  (process.exit as () => void) = () => {};
  (process.cwd as () => string) = () => tempDir;

  await listCommand();
  const output1 = logs.join("\n");

  process.cwd = originalCwd;
  process.exit = originalExit;
  console.log = originalConsoleLog;
  await fs.rm(tempDir, { recursive: true, force: true });

  assertOk(
    output1.includes("📦 Bounded Contexts"),
    "Should output Bounded Contexts header",
  );
  assertOk(output1.includes("shared"), "Should list shared context");
  assertOk(
    output1.includes("project-configuration"),
    "Should list project-configuration context",
  );
  assertOk(output1.includes("type: shared-kernel"), "Should show type");
  assertOk(output1.includes("layers: domain"), "Should show layers");
  assertOk(
    output1.includes("📱 Applications"),
    "Should output Applications header",
  );
  assertOk(output1.includes("web"), "Should list web app");
  assertOk(output1.includes("driver: next.js"), "Should show driver");
  console.log("✅ listCommand: prints contexts and apps");

  // Test 2: Empty manifest
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const archDir2 = path.join(tempDir, ".architecture");
  await fs.mkdir(archDir2, { recursive: true });
  await fs.writeFile(
    path.join(archDir2, "manifest.yaml"),
    emptyManifestYaml,
    "utf8",
  );

  originalCwd = process.cwd;
  originalExit = process.exit;
  originalConsoleLog = console.log;
  logs = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  (process.exit as () => void) = () => {};
  (process.cwd as () => string) = () => tempDir;

  await listCommand();
  const output2 = logs.join("\n");

  process.cwd = originalCwd;
  process.exit = originalExit;
  console.log = originalConsoleLog;
  await fs.rm(tempDir, { recursive: true, force: true });

  assertOk(
    output2.includes("no bounded contexts defined"),
    "Should show empty message",
  );
  console.log("✅ listCommand: handles empty manifest");

  console.log("\n✅ All listCommand tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
