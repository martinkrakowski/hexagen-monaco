import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { YamlConfigAdapter } from "../../../src/infrastructure/adapters/yaml-config.adapter.js";
import type {
  BootstrapStep,
  InvariantConfig,
  InvariantPriority,
  PortOwnershipRecord,
} from "../../../src/application/ports/out/index.js";

/**
 * Helper to create a temporary directory with a YAML config file.
 * Returns the directory path and a cleanup function.
 */
async function withTempConfig(
  yamlContent: string,
  fn: (configPath: string) => Promise<void>,
) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const configPath = path.join(tmpDir, "generator.config.yaml");
  await fs.writeFile(configPath, yamlContent, "utf8");

  try {
    await fn(configPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Minimal test suite for YamlConfigAdapter.
 * Uses Node's built‑in assert – no external test runner required.
 */
(async () => {
  // -------------------------------------------------------------------------
  // 1️⃣ Test loading an empty (non‑existent) config – defaults should be empty.
  // -------------------------------------------------------------------------
  await withTempConfig("", async (configPath) => {
    const adapter = new YamlConfigAdapter(configPath, fs, console);

    const bootstrap = await adapter.getBootstrapSequence();
    assert.deepStrictEqual(
      bootstrap,
      { success: true, value: [] },
      "Bootstrap sequence should be empty when config is missing",
    );

    const invariants = await adapter.getAllInvariants();
    assert.deepStrictEqual(
      invariants,
      { success: true, value: [] },
      "Invariants list should be empty when config is missing",
    );

    const critical = await adapter.getFailureBehavior(
      "critical" as InvariantPriority,
    );
    assert.strictEqual(
      critical,
      "abort-and-cleanup",
      "Critical failure behavior should fall back to default",
    );

    const ownership = await adapter.loadOwnershipMap();
    assert.deepStrictEqual(
      ownership,
      { success: true, value: [] },
      "Ownership map should be empty when config is missing",
    );
  });

  // -------------------------------------------------------------------------
  // 2️⃣ Test loading a fully populated config and reading values back.
  // -------------------------------------------------------------------------
  const yamlContent = `
invariants:
  - name: test-double-parity
    description: All fakes must match port signatures
    priority: medium
    enforcement: bootstrap
    failure: warn-and-continue
bootstrap-sequence:
  - name: load-ownership-map
    priority: high
    failure: abort
failure-behavior:
  critical: abort-and-cleanup
  high: abort
  medium: warn-and-continue
ownership-registry:
  ports:
    apply-semantic-patch-port: "@hexagen/monaco-orchestration"
`;
  await withTempConfig(yamlContent, async (configPath) => {
    const adapter = new YamlConfigAdapter(configPath, fs, console);

    // ---- bootstrap sequence ------------------------------------------------
    const bootstrap = await adapter.getBootstrapSequence();
    const expectedBootstrap: BootstrapStep[] = [
      {
        name: "load-ownership-map",
        priority: "high",
        failure: "abort",
        note: undefined,
      },
    ];
    assert.deepStrictEqual(
      bootstrap,
      { success: true, value: expectedBootstrap },
      "Bootstrap sequence should match the YAML content",
    );

    // ---- invariants --------------------------------------------------------
    const invariants = await adapter.getAllInvariants();
    const expectedInvariants: InvariantConfig[] = [
      {
        name: "test-double-parity",
        description: "All fakes must match port signatures",
        priority: "medium",
        enforcement: "bootstrap",
        failure: "warn-and-continue",
      },
    ];
    assert.deepStrictEqual(
      invariants,
      { success: true, value: expectedInvariants },
      "Invariants should match the YAML content",
    );

    // ---- failure behaviours -------------------------------------------------
    const critical = await adapter.getFailureBehavior(
      "critical" as InvariantPriority,
    );
    assert.strictEqual(
      critical,
      "abort-and-cleanup",
      "Critical failure behavior should be read from YAML",
    );
    const high = await adapter.getFailureBehavior("high" as InvariantPriority);
    assert.strictEqual(
      high,
      "abort",
      "High failure behavior should be read from YAML",
    );
    const medium = await adapter.getFailureBehavior(
      "medium" as InvariantPriority,
    );
    assert.strictEqual(
      medium,
      "warn-and-continue",
      "Medium failure behavior should be read from YAML",
    );

    // ---- ownership map -----------------------------------------------------
    const ownership = await adapter.loadOwnershipMap();
    const expectedOwnership: PortOwnershipRecord[] = [
      {
        portName: "apply-semantic-patch-port",
        owningPackage: "@hexagen/monaco-orchestration",
      },
    ];
    assert.deepStrictEqual(
      ownership,
      { success: true, value: expectedOwnership },
      "Ownership map should match the YAML content",
    );
  });

  console.log("✅ All YamlConfigAdapter tests passed.");
})();
