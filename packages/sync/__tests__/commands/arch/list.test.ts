import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listCommand } from "../../../src/commands/arch/list.js";

const validManifestYaml = `
description: "HexaGen Monorepo"
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
    layers:
      domain:
        entities:
          - ProjectConfig
apps:
  - name: web
    driver: next.js
`;

const emptyManifestYaml = `
description: "Empty manifest"
system: test
bounded_contexts: []
apps: []
`;

describe("listCommand", () => {
  it("should print contexts and apps from valid manifest", async () => {
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
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    (process.exit as () => void) = () => {};
    (process.cwd as () => string) = () => tempDir;

    await listCommand();
    const output1 = logs.join("\n");

    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalConsoleLog;
    await fs.rm(tempDir, { recursive: true, force: true });

    assert.ok(output1.includes("Bounded Contexts"));
    assert.ok(output1.includes("shared"));
    assert.ok(output1.includes("project-configuration"));
    assert.ok(output1.includes("type: shared-kernel"));
    assert.ok(output1.includes("layers: domain"));
    assert.ok(output1.includes("Applications"));
    assert.ok(output1.includes("web"));
    assert.ok(output1.includes("driver: next.js"));
  });

  it("should handle empty manifest", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
    const archDir2 = path.join(tempDir, ".architecture");
    await fs.mkdir(archDir2, { recursive: true });
    await fs.writeFile(
      path.join(archDir2, "manifest.yaml"),
      emptyManifestYaml,
      "utf8",
    );

    const originalCwd = process.cwd;
    const originalExit = process.exit;
    const originalConsoleLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    (process.exit as () => void) = () => {};
    (process.cwd as () => string) = () => tempDir;

    await listCommand();
    const output2 = logs.join("\n");

    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalConsoleLog;
    await fs.rm(tempDir, { recursive: true, force: true });

    assert.ok(output2.includes("no bounded contexts defined"));
  });
});
